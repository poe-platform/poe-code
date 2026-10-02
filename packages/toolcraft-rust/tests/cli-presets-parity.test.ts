import assert from "node:assert/strict";
import {beforeEach,it,vi} from "vitest";
import {Volume,createFsFromVolume} from "memfs";
import {loadPresetReference} from "./cli-presets-reference.mjs";
const io=vi.hoisted(()=>({readFile:vi.fn()}));
vi.mock("node:fs/promises",()=>({readFile:io.readFile}));
const original=loadPresetReference(io.readFile);
import * as api from "../dist/cli-presets.js";
const volume=new Volume();
beforeEach(()=>{volume.reset();io.readFile.mockReset().mockImplementation(createFsFromVolume(volume).promises.readFile);});
const field=(path:string[],schema:object,extra:object={})=>({id:path.join("."),path,displayPath:path.join("."),optionAttribute:path.join("_"),schema,...extra});
function result(run:()=>unknown){try{return {value:run()};}catch(error){return {error:{name:error.name,message:error.message}};}}
async function load(module:typeof original,fields:unknown[],dynamic:unknown[],content:string){volume.fromJSON({"/preset.json":content});try{return {value:await module.loadPresetValues(fields,dynamic,"/preset.json")};}catch(error){return {error:{name:error.name,message:error.message,cause:error.cause?.message}};}}

it("Native presets load nested scalar and dynamic defaults from an in-memory file",async()=>{
  const fields=[field(["profile","name"],{kind:"string",minLength:1}),field(["count"],{kind:"number",jsonType:"integer"}),field(["tags"],{kind:"array",item:{kind:"string"}}),field(["blob"],{kind:"json"})];
  const dynamic=[field(["jobs"],{kind:"record",value:{kind:"number"}})];
  const content=JSON.stringify({profile:{name:"🚀"},count:3,tags:["a","b"],blob:{anything:[null]},jobs:{one:4}});
  const actual=await load(api,fields,dynamic,content);
  assert.deepEqual(actual,await load(original,fields,dynamic,content));
  assert.deepEqual(actual.value,{fields:{profile_name:"🚀",count:3,tags:["a","b"],blob:{anything:[null]}},dynamic:new Map([["jobs",{one:4}]])});
});

it("Native preset field validation matches nullable values, bounds, enums and errors",async()=>{
  for(const schema of [{kind:"string",minLength:2,maxLength:4,pattern:"^a"},{kind:"number",jsonType:"integer",minimum:2},{kind:"boolean"},{kind:"enum",values:["red",1,false,null]},{kind:"array",item:{kind:"optional",inner:{kind:"number"}},minItems:1,maxItems:2},{kind:"array",item:{kind:"object",shape:{}}},{kind:"json"}]){
    for(const value of [null,undefined,"abc","a🚀",1,2.5,NaN,true,[],[1],[1,2,3],{},["bad"]]){
      for(const nullable of [false,true]){
        const f=field(["value"],{...schema,nullable});
        assert.deepEqual(result(()=>api.validatePresetFieldValue(value,f,"p.json")),result(()=>original.validatePresetFieldValue(value,f,"p.json")));
      }
    }
  }
});

it("Native presets preserve unknown paths, invalid objects, JSON diagnostics and read errors",async()=>{
  const fields=[field(["parent","name"],{kind:"string"})];
  for(const content of ["null","[]","1","{","{\n\"parent\": }",'{"parent":2}','{"unknown":1}','{"parent":{"name":2}}'])assert.deepEqual(await load(api,fields,[],content),await load(original,fields,[],content));
  for(const failure of [Object.assign(new Error("gone"),{code:"ENOENT"}),Object.assign(new Error("denied"),{code:"EACCES"}),Object.create({code:"ENOENT"}),null,undefined,new Error("")]){
    const inspect=async(module:typeof original)=>{io.readFile.mockRejectedValueOnce(failure);try{await module.loadPresetValues([],[],"/missing");assert.fail("expected failure");}catch(error){return {name:error.name,message:error.message};}};
    assert.deepEqual(await inspect(api),await inspect(original));
  }
});

it("Native presets validate dynamic schemas and report their nested issue paths",async()=>{
  const dynamic=[field(["jobs"],{kind:"array",item:{kind:"object",shape:{name:{kind:"string"},enabled:{kind:"boolean",default:true}}}})];
  for(const content of ['{"jobs":[{"name":"ok"}]}','{"jobs":[{"name":3}]}','{"jobs":false}'])assert.deepEqual(await load(api,[],dynamic,content),await load(original,[],dynamic,content));
  assert.deepEqual((await load(api,[],dynamic,'{"jobs":[{"name":"ok"}]}')).value?.dynamic.get("jobs"),[{name:"ok",enabled:true}]);
  assert.match((await load(api,[],dynamic,'{"jobs":[{"name":3}]}')).error?.message,/jobs\.0\.name/);
});

it("Native preset validation retains getter order and live array callbacks",()=>{
  function inspect(module:typeof original,value:unknown,kind:string){
    const trace:unknown[]=[],track=(value:object,name:string)=>new Proxy(value,{get(target,key,receiver){trace.push([name,String(key)]);return Reflect.get(target,key,receiver);}});
    const schema=track({kind,item:track({kind:"number"},"item"),minItems:1,maxItems:2,minLength:1,maxLength:3,pattern:"^a",values:["red",1]},"schema");
    const f=track(field(["value"],schema),"field");
    return {outcome:result(()=>module.validatePresetFieldValue(value,f,"p.json")),trace};
  }
  for(const kind of ["array","string","enum","number","json"])for(const value of [null,"abc","bad",[1,2],["bad"],[],17])assert.deepEqual(inspect(api,value,kind),inspect(original,value,kind));
  for(const module of [api,original]){
    const value=[1,2];let calls=0;
    value.map=function(callback){calls++;assert.equal(this,value);assert.equal(callback.length,1);return [callback(3)];};
    assert.deepEqual(module.validatePresetFieldValue(value,field(["value"],{kind:"array",item:{kind:"number"}}),"p"),[3]);assert.equal(calls,1);
    const data={owned:true};assert.equal(module.validatePresetFieldValue(data,field(["v"],{kind:"json"}),"p"),data);
    assert.equal(module.validatePresetScalarValue(-0,{kind:"enum",values:[0,-0]},"v","p"),-0);
    assert.ok(Number.isNaN(module.validatePresetScalarValue(NaN,{kind:"enum",values:[NaN]},"v","p")));
  }
});

it("Native preset traversal preserves map evaluation order, duplicate paths and special keys",async()=>{
  async function inspect(module:typeof original){
    const trace:unknown[]=[],track=(value:object,name:string)=>new Proxy(value,{get(target,key,receiver){trace.push([name,String(key)]);return Reflect.get(target,key,receiver);}});
    const fields=[track(field(["parent","value"],track({kind:"string"},"schema")),"field"),field(["parent","value"],{kind:"json"},{optionAttribute:"chosen"})];
    fields.map=function(callback){trace.push(["map",this===fields,callback.length]);return Array.prototype.map.call(this,callback);};
    const value=await load(module,fields,[],'{"parent":{"value":{"nested":true}}}');
    return {trace,value};
  }
  assert.deepEqual(await inspect(api),await inspect(original));
  for(const module of [api,original]){
    const fields=[field(["__proto__"],{kind:"json"}),field(["constructor"],{kind:"string"})];
    const actual=await load(module,fields,[],'{"__proto__":{"inherited":true},"constructor":"own"}');
    assert.equal(Object.getPrototypeOf(actual.value.fields).inherited,true);assert.equal(Object.hasOwn(actual.value.fields,"__proto__"),false);assert.equal(actual.value.fields.constructor,"own");
  }
});

it("Native nested-field admission retains custom some/every receivers and short circuiting",()=>{
  function inspect(module:typeof original){
    const trace:unknown[]=[],path=["a"],fields=[{path:["a","b"]}];
    fields.some=function(callback){trace.push(["some",this===fields,callback.name,callback.length]);return callback(fields[0]);};
    path.every=function(callback){trace.push(["every",this===path,callback.name,callback.length]);return callback("a",0);};
    return {value:module.hasNestedField(fields,path),trace};
  }
  assert.deepEqual(inspect(api),inspect(original));
  for(const module of [api,original]){
    assert.equal(module.hasNestedField([{path:["a"]}],["a"]),false);
    assert.equal(module.hasNestedField([{path:["a","b"]}],["a"]),true);
    const stop={some:()=>"custom"};assert.equal(module.hasNestedField(stop,[]),"custom");
  }
});

it("Native presets preserve read timing, error getters and independent concurrent loads",async()=>{
  async function inspect(module:typeof original){
    const trace:unknown[]=[];
    io.readFile.mockImplementationOnce((path,options)=>{trace.push(["read",path,options]);return {get then(){trace.push("then");return (resolve:(value:string)=>void)=>{trace.push("resolve");resolve("{}");};}};});
    const pending=module.loadPresetValues([],[],"p");trace.push("returned");queueMicrotask(()=>trace.push("tick"));const value=await pending;trace.push("done");return {trace,value};
  }
  assert.deepEqual(await inspect(api),await inspect(original));
  for(const module of [api,original]){
    const releases:Array<(value:string)=>void>=[];io.readFile.mockImplementation(()=>new Promise(resolve=>releases.push(resolve)));
    const fields=[field(["value"],{kind:"number"})],first=module.loadPresetValues(fields,[],"first"),second=module.loadPresetValues(fields,[],"second");
    releases[1]('{"value":2}');assert.equal((await second).fields.value,2);releases[0]('{"value":1}');assert.equal((await first).fields.value,1);
    const trace:unknown[]=[],failure=new Error("denied");Object.defineProperty(failure,"message",{get(){trace.push("message");return trace.length===1?"nonempty":"changed";}});
    io.readFile.mockRejectedValueOnce(failure);await assert.rejects(module.loadPresetValues([],[],"p"),{message:'Preset file "p" could not be read: changed'});assert.deepEqual(trace,["message","message"]);
  }
});

it("Native presets retain arbitrary thrown identity and JSON parser causes",async()=>{
  for(const module of [api,original]){
    for(const failure of [undefined,null,false,19,Symbol("failure"),new Error("failure")]){
      io.readFile.mockResolvedValueOnce('{"value":1}');
      const f=field(["value"],{kind:"number"});Object.defineProperty(f,"schema",{get(){throw failure;}});
      await assert.rejects(module.loadPresetValues([f],[],"p"),error=>error===failure);
    }
    const cause=Object.assign(new SyntaxError("broken input"),{position:2});
    io.readFile.mockResolvedValueOnce("bad");const parse=vi.spyOn(JSON,"parse").mockImplementationOnce(()=>{throw cause;});
    try{await assert.rejects(module.loadPresetValues([],[],"p"),error=>error.cause===cause&&error.message.includes("line 1 column 3"));}finally{parse.mockRestore();}
  }
});
