import test from "node:test";
import assert from "node:assert/strict";
import {Volume, createFsFromVolume} from "memfs";
import {deepMergeDocuments, readDocumentReadonly, readDocument, writeScope, resolveScope} from "../dist/index.js";
test("config preserves opaque identity, literal keys and safe invalid-document recovery",async()=>{
 const opaque=()=>1, nested={opaque}, array=[opaque];
 const a={core:{nested,array},runtime:{build_args:{A:"one"}}};
 const b={core:{other:true},runtime:{build_args:{B:"two"}}};
 const result=deepMergeDocuments(a,b);
 assert.equal(result.core.nested,nested);assert.equal(result.core.array,array);
 assert.deepEqual(result.runtime.build_args,{A:"one",B:"two"});
 const volume=Volume.fromJSON({"/home/config.json":"not json"},"/"),fs=createFsFromVolume(volume).promises;
 await assert.rejects(readDocumentReadonly(fs,"/home/config.json"),SyntaxError);
 assert.equal(await fs.readFile("/home/config.json","utf8"),"not json");
 assert.deepEqual(await readDocument(fs,"/home/config.json"),{});
 await writeScope(fs,"/home/config.json","__proto__",JSON.parse('{"__proto__":"data"}'));
 const data=JSON.parse(await fs.readFile("/home/config.json","utf8"));assert.ok(Object.hasOwn(data,"__proto__"));assert.equal(data.__proto__.__proto__,"data");
 const field={type:"number",default:2,doc:"test",env:"N"};assert.deepEqual(resolveScope({value:field},{value:"0x10"},{N:"Infinity"}),{value:16});
});
test("primitive schema getters are read once and file coercion remains eager",()=>{
 let reads=0;
 const field={get type(){reads++;return "number";},default:2,doc:"number",env:"N"};
 assert.deepEqual(resolveScope({value:field},{value:"0x10"},{N:"4"}),{value:4});
 assert.equal(reads,2); // One coercion for env, one for file.
 const json={type:"json",default:null,doc:"json",env:"J",parse:value=>{if(value===false)throw Error("file rejected");return value;}};
 assert.throws(()=>resolveScope({value:json},{value:false},{J:"true"}),/file rejected/);
});
test("runtime recursion is bounded and failed policies leave inputs unchanged",()=>{
 const left={},right={};left.self=left;right.self=right;
 assert.throws(()=>deepMergeDocuments({runtime:left},{runtime:right}),/depth exceeded/);
 assert.equal(left.self,left);assert.equal(right.self,right);
 const original=JSON.parse('{"__proto__":{"__proto__":"literal"}}');
 const merged=deepMergeDocuments(original,{});
 assert.equal(Object.hasOwn(merged,"__proto__"),true);assert.equal(merged.__proto__.__proto__,"literal");
});
test("record snapshots promote shared shallow shells when runtime needs deeper merging",()=>{
 const leftArgs={A:"one"},rightArgs={B:"two"},left={args:leftArgs},right={args:rightArgs};
 const result=deepMergeDocuments({core:left,runtime:left},{core:right,runtime:right});
 assert.equal(result.core.args,rightArgs);
 assert.deepEqual(result.runtime.args,{A:"one",B:"two"});
 const leftRuntime={};Object.defineProperty(leftRuntime,"A",{value:"one"});
 assert.deepEqual(deepMergeDocuments({runtime:{args:leftRuntime}},{runtime:{args:{A:undefined,B:"two"}}}).runtime.args,{A:"one",B:"two"});
});

test('stored JSON path preserves duplicate keys, signed zero, UTF16 and deep fallbacks',async()=>{
 const {readDocumentReadonly}=await import('../dist/index.js');
 const {Volume,createFsFromVolume}=await import('memfs');
 const fs=createFsFromVolume(Volume.fromJSON({'/config.json':'{"empty":{},"list":[],"core":{"__proto__":1,"a":1,"a":2,"s":"\\ud800","n":-0,"huge":1e400}}'},'/')).promises;
 const result=await readDocumentReadonly(fs,'/config.json');
 assert.deepEqual(Object.keys(result),['core']);assert.ok(Object.hasOwn(result.core,'__proto__'));assert.equal(result.core.a,2);assert.equal(result.core.s,'\ud800');assert.ok(Object.is(result.core.n,-0));assert.equal(result.core.huge,Infinity);
 const deep='{"core":{"value":'+ '['.repeat(600)+'0'+']'.repeat(600)+'}}';await fs.writeFile('/config.json',deep,'utf8');
 let value=(await readDocumentReadonly(fs,'/config.json')).core.value;for(let n=0;n<600;n++)value=value[0];assert.equal(value,0);
 await fs.writeFile('/config.json','{bad}','utf8');await assert.rejects(readDocumentReadonly(fs,'/config.json'),SyntaxError);
});
test('stored JSON path preserves changed host parse and enumeration hooks',async()=>{
 const {readDocumentReadonly}=await import('../dist/index.js');
 const {Volume,createFsFromVolume}=await import('memfs');
 const fs=createFsFromVolume(Volume.fromJSON({'/config.json':'{"core":{"a":1}}'},'/')).promises;
 const parse=JSON.parse,entries=Object.entries;let parses=0,enumerations=0;
 JSON.parse=function(...args){parses++;return parse(...args);};Object.entries=function(...args){enumerations++;return entries(...args);};
 try{assert.equal((await readDocumentReadonly(fs,'/config.json')).core.a,1);}finally{JSON.parse=parse;Object.entries=entries;}
 assert.ok(parses>0);assert.ok(enumerations>0);
});
