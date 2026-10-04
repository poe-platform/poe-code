import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSofficeCommand, runSofficeFileCli } from "./index.js";

for (const mode of ["sdk", "command"]) it(`${mode} streams text cat through caller backing without whole-file input or eager output`, async () => {
  const fs = new MemoryFileSystem();
  const bytes = new Uint8Array(1100000).fill(97);
  bytes.set([239,187,191]); bytes.set([240,159,152,128],16383); bytes[bytes.length-1]=255;
  await fs.writeFile("/input.txt",bytes);
  let opened=0, closed=0, largest=0, output="", writes=0;
  const filesystem=new Proxy(fs,{get(target,key){
    if(key==="readFile")return ()=>{throw new Error("whole-file input forbidden");};
    if(key==="open")return async(...args:Parameters<typeof fs.open>)=>{
      const handle=await fs.open(...args);opened++;
      return new Proxy(handle,{get(target,key){if(key==="close")return async()=>{closed++;await handle.close();};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
    };
    const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
  }});
  const context={command:"soffice",cwd:"/",env:{},fs:filesystem,
    ...createCommandArguments(["--cat","/input.txt","/./input.txt"]),signal:new AbortController().signal,stdin:toByteSource(""),
    stdout:{async write(chunk:Uint8Array){largest=Math.max(largest,chunk.length);writes++;await Promise.resolve();output+=new TextDecoder().decode(chunk);}},
    stderr:{async write(chunk:Uint8Array){throw new Error(new TextDecoder().decode(chunk));}}
  };
  const result=mode==="command"?await createSofficeCommand().execute(context):await runSofficeFileCli(context.args,{filesystem,cwd:"/",signal:context.signal,stdout:context.stdout,stderr:context.stderr});
  assert.equal(result.exitCode,0);
  assert.equal(output,new TextDecoder().decode(bytes)+"\n"+new TextDecoder().decode(bytes)+"\n");
  assert.ok(writes>2);assert.ok(largest<=49152);assert.ok(opened>0);assert.equal(closed,opened);
  assert.deepEqual((await fs.readdir("/")).map(entry=>entry.name),["input.txt"]);
});

for (const mode of ["input-limit", "output-limit", "missing", "cancel", "sink"] as const) it(`retains text cat cleanup and admission on ${mode}`,async()=>{
  const fs=new MemoryFileSystem(),bytes=new Uint8Array(1100000).fill(97),controller=new AbortController(),failure=new Error(mode);
  await fs.writeFile("/input",bytes);
  let writes=0,opened=0,closed=0;
  const filesystem=new Proxy(fs,{get(target,key){
    if(key==="readFile")return ()=>{throw new Error("whole-file input forbidden");};
    if(key==="open")return async(...args:Parameters<typeof fs.open>)=>{
      const handle=await fs.open(...args);opened++;
      return new Proxy(handle,{get(target,key){if(key==="close")return async()=>{closed++;await handle.close();};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
    };
    const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
  }});
  let diagnostic="";
  const execution=runSofficeFileCli(["--cat","/input",...(mode==="missing"?["/missing"]:[])],{
    filesystem,signal:controller.signal,
    limits:mode==="input-limit"?{maxInputBytes:1050000}:mode==="output-limit"?{maxOutputBytes:bytes.length}:{},
    stdout:{async write(){writes++;if(mode==="sink")throw failure;if(mode==="cancel")controller.abort(failure);}},
    stderr:{async write(bytes){diagnostic+=new TextDecoder().decode(bytes);}}
  });
  if(mode==="missing"){assert.equal((await execution).exitCode,1);assert.match(diagnostic,/source file could not be loaded: \/missing/);}
  else await assert.rejects(execution,error=>mode==="input-limit"||mode==="output-limit"?error instanceof RangeError:error===failure);
  if(mode!=="sink"&&mode!=="cancel")assert.equal(writes,0);
  assert.ok(opened>0);assert.equal(closed,opened);
  assert.deepEqual((await fs.readdir("/")).map(entry=>entry.name),["input"]);
});

it("decodes split UTF-8, a per-file BOM, and an incomplete final sequence like the buffer SDK",async()=>{
  const fs=new MemoryFileSystem();await fs.writeFile("/input",new Uint8Array());
  const chunks=[Uint8Array.of(239),Uint8Array.of(187,191,240),Uint8Array.of(159),Uint8Array.of(152,128,226)];
  const filesystem=new Proxy(fs,{get(target,key){if(key==="readStream")return async function*(){for(const chunk of chunks)yield chunk;};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
  let output="";
  const result=await runSofficeFileCli(["--cat","/input","/input"],{filesystem,stdout:{async write(bytes){output+=new TextDecoder().decode(bytes);}},stderr:{async write(){assert.fail("unexpected stderr");}}});
  assert.equal(result.exitCode,0);assert.equal(output,"😀�\n😀�\n");
});
