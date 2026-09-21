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
