import {test} from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import {syncBuiltinESMExports} from "node:module";
import * as native from "../dist/index.js";
import * as reference from "tiny-mcp-client";

test("public header snapshots own normalized values and preserve safe validation errors",()=>{
  assert.equal(typeof native.snapshotHttpTransportHeaders,"function");
  for(const value of [undefined,{Authorization:"Bearer fixture"},[["X-Example","a"],["X-Example","b"]],new Headers({"X-Example":"value"})]){
    assert.deepEqual([...native.snapshotHttpTransportHeaders(value)],[...reference.snapshotHttpTransportHeaders(value)]);
  }
  for(const api of [native,reference]){
    const input=new Headers({"X-Example":"before"}),snapshot=api.snapshotHttpTransportHeaders(input);
    input.set("X-Example","after");assert.equal(snapshot.get("X-Example"),"before");
    for(const invalid of [{"invalid name":"private value"},[["only-name"]],{get authorization(){throw Symbol("private failure");}}])assert.throws(()=>api.snapshotHttpTransportHeaders(invalid),{name:"Error",message:"Invalid HTTP transport headers"});
  }
});

test("public header snapshots retain the live platform constructor",()=>{
  assert.equal(typeof native.snapshotHttpTransportHeaders,"function");
  const saved=globalThis.Headers,marker={},input={opaque:true};
  try{
    globalThis.Headers=function(value){assert.equal(value,input);return marker;};
    assert.equal(native.snapshotHttpTransportHeaders(input),marker);assert.equal(reference.snapshotHttpTransportHeaders(input),marker);
    globalThis.Headers=function(){throw Symbol("hidden");};
    for(const api of [native,reference])assert.throws(()=>api.snapshotHttpTransportHeaders(input),{name:"Error",message:"Invalid HTTP transport headers"});
  }finally{globalThis.Headers=saved;}
});

test("public default stdio spawn preserves its API shape and opaque host arguments",()=>{
  assert.equal(typeof native.defaultStdioSpawn,"function");
  assert.equal(native.defaultStdioSpawn.name,reference.defaultStdioSpawn.name);
  assert.equal(native.defaultStdioSpawn.length,reference.defaultStdioSpawn.length);
  const saved=childProcess.spawn,args=Object.freeze(["argument"]),options={cwd:"/virtual",env:{EXAMPLE:"value"}},child={},failure=Symbol("spawn failure");
  let reject=false,calls=0;
  childProcess.spawn=function(command,receivedArgs,receivedOptions){assert.equal(this,undefined);assert.equal(command,"command");assert.equal(receivedArgs,args);assert.equal(receivedOptions,options);calls++;if(reject)throw failure;return child;};
  syncBuiltinESMExports();
  try{
    for(const api of [native,reference])assert.equal(api.defaultStdioSpawn("command",args,options),child);
    reject=true;for(const api of [native,reference])assert.throws(()=>api.defaultStdioSpawn("command",args,options),error=>error===failure);
    assert.equal(calls,4);
  }finally{childProcess.spawn=saved;syncBuiltinESMExports();}
});
