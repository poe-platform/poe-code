import assert from "node:assert/strict";
import { it } from "node:test";
import { compareIdentity } from "@poe-code/safe-fs/contracts";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runSofficeCli, runSofficeFileCli } from "./index.js";

for (const [name, source, format] of [
  ["input.txt", "source text\n", "txt"],
  ["input.rtf", String.raw`{\rtf1 Title\par second & <third>}`, "txt"],
  ["input.rtf", String.raw`{\rtf1 Title\par second & <third>}`, "html"]
]) it(`retains ${name} to ${format} through the file SDK`,async()=>{
  const fs=new MemoryFileSystem();await fs.mkdir("/out");const bytes=new TextEncoder().encode(source!);
  await fs.writeFile("/"+name,bytes);
  const args=["--convert-to",format!,"--outdir","/out","/"+name];
  const files=new Map([["/"+name,bytes]]),expected=await runSofficeCli(args,files);
  const filesystem=new Proxy(fs,{get(target,key){
    if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("whole-file I/O forbidden");};
    const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
  }});
  let stdout="",stderr="";
  const actual=await runSofficeFileCli(args,{filesystem,stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
  assert.deepEqual({...actual,stdout,stderr},expected);
  assert.deepEqual(await fs.readFile("/out/input."+format),files.get("/out/input."+format));
  assert.deepEqual((await fs.readdir("/out")).map(entry=>entry.name),["input."+format]);
});

for (const format of ["txt", "html"]) it(`keeps large RTF output contiguous while metadata caches spill (${format})`,async()=>{
  const fs=new MemoryFileSystem();await fs.mkdir("/out");
  const bytes=new TextEncoder().encode("{\\rtf1 "+"a & ".repeat(300000)+"\\par "+"next\\par ".repeat(5000)+"}");
  await fs.writeFile("/input.rtf",bytes);
  const args=["--convert-to",format,"--outdir","/out","/input.rtf"],files=new Map([["/input.rtf",bytes]]);
  const expected=await runSofficeCli(args,files);
  const filesystem=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile")return ()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
  const actual=await runSofficeFileCli(args,{filesystem,stdout:{async write(){}},stderr:{async write(bytes){assert.fail(new TextDecoder().decode(bytes));}}});
  assert.equal(actual.exitCode,expected.exitCode);assert.deepEqual(await fs.readFile("/out/input."+format),files.get("/out/input."+format));
  assert.deepEqual((await fs.readdir("/")).map(entry=>entry.name).sort(),["input.rtf","out"]);
});

for (const kind of ["file","symlink","hardlink"] as const) it(`preserves output identity and mode through ${kind}`,async()=>{
  const fs=new MemoryFileSystem();await fs.writeFile("/input.rtf",new TextEncoder().encode("{\\rtf1 visible}"));
  await fs.mkdir("/out");await fs.writeFile("/out/input.txt",new TextEncoder().encode("saved"));await fs.chmod("/out/input.txt",0o640);
  if(kind==="hardlink")await fs.link("/out/input.txt","/alias");
  if(kind==="symlink"){await fs.rename("/out/input.txt","/target");await fs.symlink("/target","/out/input.txt");}
  const before=await fs.stat("/out/input.txt");
  const result=await runSofficeFileCli(["--convert-to","txt","--outdir","/out","/input.rtf"],{filesystem:fs,stdout:{async write(){}},stderr:{async write(){assert.fail("unexpected diagnostic");}}});
  const after=await fs.stat("/out/input.txt");
  assert.equal(result.exitCode,0);assert.equal(after.mode,before.mode);assert.equal(compareIdentity(before,after),"same");
  assert.equal(new TextDecoder().decode(await fs.readFile(kind==="hardlink"?"/alias":kind==="symlink"?"/target":"/out/input.txt")),"visible\n");
  if(kind==="symlink")assert.equal((await fs.lstat("/out/input.txt")).type,"symlink");
});

for(const mode of ["write","finish","publish","cancel","budget"] as const)it(`preserves existing output and retires staging on ${mode}`,async()=>{
  const fs=new MemoryFileSystem(),controller=new AbortController(),failure=new Error(mode),saved=new TextEncoder().encode("saved");
  await fs.writeFile("/input.rtf",new TextEncoder().encode("{\\rtf1 "+"a".repeat(1100000)+"}"));await fs.writeFile("/input.txt",saved);
  let created=0,removed=0,closed=0;
  const filesystem=new Proxy(fs,{get(target,key){
    if(key==="publishStagedFile"&&mode==="publish")return async()=>{throw failure;};
    if(key==="createStagedFile")return async(...args:Parameters<NonNullable<typeof fs.createStagedFile>>)=>{
      const stage=await fs.createStagedFile(...args);created++;
      return {...stage,writer:{async write(bytes:Uint8Array,options?:{signal?:AbortSignal}){if(mode==="write")throw failure;await stage.writer!.write(bytes,options);if(mode==="cancel")controller.abort(failure);},async finish(options?:{signal?:AbortSignal}){if(mode==="finish")throw failure;return stage.writer!.finish(options);}},
        cleanup:{async remove(){removed++;await stage.cleanup!.remove();},async close(){closed++;await stage.cleanup!.close();}}};
    };
    const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
  }});
  const execution=runSofficeFileCli(["--convert-to","txt","/input.rtf"],{filesystem,signal:controller.signal,limits:mode==="budget"?{maxOutputBytes:100}:{},stdout:{async write(){}},stderr:{async write(){assert.fail("unexpected diagnostic");}}});
  await assert.rejects(execution,error=>mode==="budget"?error instanceof RangeError:error===failure);
  assert.deepEqual(await fs.readFile("/input.txt"),saved);assert.equal(removed,created);assert.equal(closed,created);
  assert.deepEqual((await fs.readdir("/")).map(entry=>entry.name).sort(),["input.rtf","input.txt"]);
});

it("replays earlier conversion results when they are later input operands",async()=>{
  const fs=new MemoryFileSystem(),bytes=new TextEncoder().encode("{\\rtf1   first \\par second }");
  await fs.mkdir("/out");await fs.writeFile("/input.rtf",bytes);
  const args=["--convert-to","rtf","--outdir","/out","/input.rtf","/out/input.rtf"];
  const files=new Map([["/input.rtf",bytes]]),expected=await runSofficeCli(args,files);let stdout="",stderr="";
  const actual=await runSofficeFileCli(args,{filesystem:fs,stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
  assert.deepEqual({...actual,stdout,stderr},expected);assert.deepEqual(await fs.readFile("/out/input.rtf"),files.get("/out/input.rtf"));
});

for(const race of ["ancestor","destination"] as const)it(`refuses a changed ${race} before publication`,async()=>{
  const fs=new MemoryFileSystem(),encode=(value:string)=>new TextEncoder().encode(value);
  await fs.mkdir("/out");await fs.writeFile("/input.rtf",encode("{\\rtf1 replacement}"));await fs.writeFile("/out/input.txt",encode("saved"));
  const filesystem=new Proxy(fs,{get(target,key){
    if(key==="createStagedFile")return async(...args:Parameters<NonNullable<typeof fs.createStagedFile>>)=>{
      const stage=await fs.createStagedFile(...args);
      return {...stage,writer:{...stage.writer!,write:stage.writer!.write.bind(stage.writer),async finish(options?:{signal?:AbortSignal}){
        const sealed=await stage.writer!.finish(options);
        if(race==="ancestor"){await fs.rename("/out","/saved");await fs.mkdir("/out");}
        await fs.writeFile("/out/input.txt",encode("concurrent output"));return sealed;
      }}};
    };
    const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
  }});
  await assert.rejects(runSofficeFileCli(["--convert-to","txt","--outdir","/out","/input.rtf"],{filesystem,stdout:{async write(){}},stderr:{async write(){assert.fail("unexpected diagnostic");}}}),error=>error instanceof Error&&"code" in error&&error.code==="EAGAIN");
  assert.equal(new TextDecoder().decode(await fs.readFile("/out/input.txt")),"concurrent output");
  if(race==="ancestor")assert.equal(new TextDecoder().decode(await fs.readFile("/saved/input.txt")),"saved");
  assert.deepEqual((await fs.readdir(race==="ancestor"?"/saved":"/out")).map(entry=>entry.name),["input.txt"]);
});
