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

for (const mode of ["input-limit", "output-limit", "missing", "cancel", "sink", "parse-cancel"] as const) it(`retains text cat cleanup and admission on ${mode}`,async()=>{
  const fs=new MemoryFileSystem(),bytes=new Uint8Array(1100000).fill(97),controller=new AbortController(),failure=new Error(mode);
  const input=mode==="parse-cancel"?"/input.rtf":"/input";
  await fs.writeFile(input,bytes);
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
  const execution=runSofficeFileCli(["--cat",input,...(mode==="missing"?["/missing"]:[])],{
    filesystem,signal:controller.signal,
    inputBudget:{check(count){if(mode==="parse-cancel"&&count===bytes.length)setTimeout(()=>controller.abort(failure),0);}},
    limits:mode==="input-limit"?{maxInputBytes:1050000}:mode==="output-limit"?{maxOutputBytes:bytes.length}:{},
    stdout:{async write(){writes++;if(mode==="sink")throw failure;if(mode==="cancel")controller.abort(failure);}},
    stderr:{async write(bytes){diagnostic+=new TextDecoder().decode(bytes);}}
  });
  if(mode==="missing"){assert.equal((await execution).exitCode,1);assert.match(diagnostic,/source file could not be loaded: \/missing/);}
  else await assert.rejects(execution,error=>mode==="input-limit"||mode==="output-limit"?error instanceof RangeError:error===failure);
  if(mode!=="sink"&&mode!=="cancel")assert.equal(writes,0);
  assert.ok(opened>0);assert.equal(closed,opened);
  assert.deepEqual((await fs.readdir("/")).map(entry=>entry.name),[input.slice(1)]);
});

it("decodes split UTF-8, a per-file BOM, and an incomplete final sequence like the buffer SDK",async()=>{
  const fs=new MemoryFileSystem();await fs.writeFile("/input",new Uint8Array());
  const chunks=[Uint8Array.of(239),Uint8Array.of(187,191,240),Uint8Array.of(159),Uint8Array.of(152,128,226)];
  const filesystem=new Proxy(fs,{get(target,key){if(key==="readStream")return async function*(){for(const chunk of chunks)yield chunk;};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
  let output="";
  const result=await runSofficeFileCli(["--cat","/input","/input"],{filesystem,stdout:{async write(bytes){output+=new TextDecoder().decode(bytes);}},stderr:{async write(){assert.fail("unexpected stderr");}}});
  assert.equal(result.exitCode,0);assert.equal(output,"😀�\n😀�\n");
});

for (const [index, source] of [
  String.raw`{\rtf1\ansi{\fonttbl{\f0 Hidden;}}{\info{\title Hidden}}{\*\unknown Gone} First \i line\i0\par Second line.\b0\line Third\tab cell. }`,
  "{\\rtf1 A\\{brace\\} and \\\\ path \\'e9\ncontinued\\par End}",
  String.raw`{\rtf1 \par\par  title\tab \par  body\~\par\bin4 {}xxend}`,
  String.raw`{\rtf1\bin-3 negative\bin999999999999999999999 huge\unknowncontrol123 text\'zz lost\'a}`,
  "}".repeat(10)+"{".repeat(20000)+"retained"+"}".repeat(20000),
  "{\\*hidden"+"{".repeat(20000)+"lost"+"}".repeat(20000)+"stillhidden}visible"
].entries()) it("retains RTF extraction with the buffer SDK's existing semantics",async()=>{
  const bytes=new TextEncoder().encode(source),fs=new MemoryFileSystem();await fs.writeFile("/input.rtf",bytes);
  const {runSofficeCli}=await import("./index.js");
  const expected=await runSofficeCli(["--cat","/input.rtf"],new Map([["/input.rtf",bytes]]));
  const filesystem=new Proxy(fs,{get(target,key){if(key==="readFile")return ()=>{throw new Error("whole-file input forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
  let stdout="",stderr="";
  const actual=await runSofficeFileCli(["--cat","/input.rtf"],{filesystem,stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
  const frozen=["First line\nSecond line.\nThird\tcell.\n","A{brace} and \\ path écontinued\nEnd\n","title\nbody\nend\n","negativehugetext lost\n","retained\n","visible\n"][index];
  assert.equal(expected.stdout,frozen);assert.deepEqual({...actual,stdout,stderr},expected);
});

it("retains very long RTF paragraphs and trims trailing whitespace without collecting a line",async()=>{
  const fs=new MemoryFileSystem(),source="{\\rtf1 "+"a".repeat(1100000)+" \\tab \\par   next \\par }";
  await fs.writeFile("/long.rtf",new TextEncoder().encode(source));
  let output="",largest=0;const decoder=new TextDecoder();
  const filesystem=new Proxy(fs,{get(target,key){if(key==="readFile")return ()=>{throw new Error("whole-file input forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
  const result=await runSofficeFileCli(["--cat","/long.rtf"],{filesystem,stdout:{async write(bytes){largest=Math.max(largest,bytes.length);output+=decoder.decode(bytes,{stream:true});}},stderr:{async write(){assert.fail("unexpected stderr");}}});
  output+=decoder.decode();assert.equal(result.exitCode,0);assert.equal(output,"a".repeat(1100000)+"\nnext\n");assert.ok(largest<=4096);
  assert.deepEqual((await fs.readdir("/")).map(entry=>entry.name),["long.rtf"]);
});

it("keeps paragraph indexes separate across mixed RTF and text operands and aliases",async()=>{
  const fs=new MemoryFileSystem();
  await fs.writeFile("/first.rtf",new TextEncoder().encode("{\\rtf1 "+"a".repeat(5000)+"\\par first}"));
  await fs.writeFile("/second.rtf",new TextEncoder().encode("{\\rtf1 second}"));
  await fs.writeFile("/text",new TextEncoder().encode("plain"));
  let output="";const decoder=new TextDecoder();
  const result=await runSofficeFileCli(["--cat","/first.rtf","/text","/second.rtf","/./first.rtf"],{filesystem:fs,stdout:{async write(bytes){output+=decoder.decode(bytes,{stream:true});}},stderr:{async write(){assert.fail("unexpected stderr");}}});
  output+=decoder.decode();assert.equal(result.exitCode,0);assert.equal(output,"a".repeat(5000)+"\nfirst\nplain\nsecond\n"+"a".repeat(5000)+"\nfirst\n");
});

it("keeps filename-based RTF selection when normalized operands share one snapshot",async()=>{
  const fs=new MemoryFileSystem(),text="{\\rtf1  visible }";
  await fs.writeFile("/input.rtf",new TextEncoder().encode(text));let stdout="";
  const result=await runSofficeFileCli(["--cat","/input.rtf","/input.rtf/."],{filesystem:fs,stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(){assert.fail("unexpected stderr");}}});
  assert.equal(result.exitCode,0);assert.equal(stdout,"visible\n"+text+"\n");
});
