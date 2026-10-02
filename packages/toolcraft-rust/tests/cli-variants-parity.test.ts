import assert from "node:assert/strict";
import {beforeEach,it,vi} from "vitest";
import {loadVariantReference} from "./cli-variants-reference.mjs";
const prompt=vi.hoisted(()=>vi.fn());
vi.mock("../dist/cli-prompts.js",()=>({promptForField:prompt}));
const original=loadVariantReference(prompt);
import * as api from "../dist/cli-variants.js";
beforeEach(()=>{prompt.mockReset();});
const field=(id:string,path:string[],extra:object={})=>({id,path,displayPath:path.join("."),optionFlag:"--"+path.join("."),schema:{kind:"string"},hasDefault:false,...extra});
function fixture(){
  const fields=[field("mode",["mode"],{schema:{kind:"enum",values:["local","remote"]}}),field("path",["path"],{variantId:"variant"}),field("url",["url"],{variantId:"variant"})];
  const dynamic=[field("labels",["labels"],{variantId:"variant",optionPathDisplay:"labels.<key>"})];
  const variants=[{id:"variant",controlFieldId:"mode",controlDisplayPath:"mode",optional:false,branches:[{branchId:"local",fieldIds:["path"],dynamicFieldIds:["labels"],requiredFieldIds:["path"],requiredDynamicFieldIds:["labels"]},{branchId:"remote",fieldIds:["url"],dynamicFieldIds:[],requiredFieldIds:["url"],requiredDynamicFieldIds:[]}]}];
  return {fields,dynamic,variants};
}
async function run(module:typeof original,selected:unknown,params:Record<string,unknown>={},provided:string[]=[],providedDynamic:string[]=[],shouldPrompt=false,setup=(value:ReturnType<typeof fixture>)=>value){
  const data=setup(fixture()),resolved=new Map(selected===undefined?[]:[["mode",selected]]),fieldIds=new Set(provided),dynamicIds=new Set(providedDynamic),errors:unknown[]=[];
  await module.enforceVariantConstraints(params,data.fields,data.dynamic,data.variants,resolved,dynamicIds,fieldIds,shouldPrompt,errors,{});
  return {params,resolved,fieldIds,dynamicIds,errors};
}

it("Native variants preserve required selectors, invalid selections and inactive-branch errors",async()=>{
  for(const [selected,params,provided,dynamic] of [[undefined,{},[],[]],["missing",{},[],[]],["local",{},[],[]],["local",{url:"bad"},["url"],[]],["remote",{labels:{}},[],["labels"]],["local",{path:"here",labels:{tag:"one"}},["path"],["labels"]]] as const)assert.deepEqual(await run(api,selected,{...params},[...provided],[...dynamic]),await run(original,selected,{...params},[...provided],[...dynamic]));
});

it("Native variants clone selected defaults and retain existing values",async()=>{
  const setup=(value:ReturnType<typeof fixture>)=>{Object.assign(value.fields[1],{hasDefault:true,defaultValue:{nested:[1,2]}});Object.assign(value.dynamic[0],{hasDefault:true,defaultValue:{tag:"default"}});return value;};
  assert.deepEqual(await run(api,"local",{},[],[],false,setup),await run(original,"local",{},[],[],false,setup));
  for(const module of [api,original]){
    const data=setup(fixture()),params={},resolved=new Map([["mode","local"]]);await module.enforceVariantConstraints(params,data.fields,data.dynamic,data.variants,resolved,new Set(),new Set(),false,[],{});
    assert.notEqual(params.path,data.fields[1].defaultValue);assert.notEqual(params.labels,data.dynamic[0].defaultValue);assert.equal(resolved.get("path"),params.path);
    assert.deepEqual((await run(module,"local",{path:"kept",labels:{tag:"kept"}},[],[],false,setup)).params,{path:"kept",labels:{tag:"kept"}});
  }
});

it("Native variants route selector and required-field prompts with original stream identity",async()=>{
  for(const module of [api,original]){
    prompt.mockReset().mockImplementation(async field=>field.id==="mode"?"local":"entered");
    const data=fixture(),params={},resolved=new Map(),ids=new Set(),errors=[],streams={input:{identity:"input"},output:{identity:"output"}};
    await module.enforceVariantConstraints(params,data.fields,data.dynamic,data.variants,resolved,new Set(),ids,true,errors,streams);
    assert.deepEqual(params,{mode:"local",path:"entered"});assert.deepEqual([...ids],["mode","path"]);
    assert.equal(prompt.mock.calls[0][0],data.fields[0]);assert.equal(prompt.mock.calls[1][0],data.fields[1]);assert.equal(prompt.mock.calls[0][1],streams);assert.equal(prompt.mock.calls[1][1],streams);
    assert.equal(errors.length,1);assert.equal(errors[0].path,"labels");
  }
});

it("Native variants gate nested branches and omit synthetic control writes",async()=>{
  const setup=(data:ReturnType<typeof fixture>)=>{Object.assign(data.fields[0],{synthetic:true});Object.assign(data.variants[0],{optional:true});data.variants.push({...data.variants[0],id:"nested",controlFieldId:"nested-mode",parent:{id:"variant",branchId:"local"}});return data;};
  assert.deepEqual(await run(api,undefined,{},[],[],false,setup),await run(original,undefined,{},[],[],false,setup));
  assert.deepEqual(await run(api,"remote",{url:"there"},[],[],false,setup),await run(original,"remote",{url:"there"},[],[],false,setup));
  prompt.mockImplementation(async field=>field.id==="mode"?"local":"value");
  assert.deepEqual(await run(api,undefined,{labels:{}},[],[],true,setup),await run(original,undefined,{labels:{}},[],[],true,setup));
});

it("Native variants retain getter order and supplied Map and Set method receivers",async()=>{
  async function inspect(module:typeof original){
    const trace:unknown[]=[],data=fixture(),track=(value:object,label:string)=>new Proxy(value,{get(target,key,receiver){trace.push([label,String(key)]);return Reflect.get(target,key,receiver);}});
    const fields=data.fields.map((value,index)=>track(value,"field"+index)),variants=data.variants.map(value=>track(value,"variant"));
    const resolved={get(id:string){trace.push(["get",this===resolved,id]);return id==="mode"?"local":undefined;},set(id:string,value:unknown){trace.push(["set",this===resolved,id,value]);}};
    const provided={has(id:string){trace.push(["has",this===provided,id]);return id==="url";},add(id:string){trace.push(["add",this===provided,id]);}};
    const params={},errors:unknown[]=[];
    await module.enforceVariantConstraints(params,fields,data.dynamic,track(variants,"variants"),resolved,new Set(),provided,false,errors,{});
    return {trace,params,errors};
  }
  assert.deepEqual(await inspect(api),await inspect(original));
});

it("Native variant prompts preserve await timing, state mutations and independent concurrent runs",async()=>{
  async function inspect(module:typeof original){
    const trace:unknown[]=[];prompt.mockImplementation(field=>({get then(){trace.push(["then",field.id]);return (resolve:(value:unknown)=>void)=>{trace.push(["resolve",field.id]);resolve(field.id==="mode"?"local":"value");};}}));
    const pending=run(module,undefined,{labels:{}},[],[],true);trace.push("returned");queueMicrotask(()=>trace.push("tick"));const result=await pending;trace.push("done");return {trace,result};
  }
  assert.deepEqual(await inspect(api),await inspect(original));
  for(const module of [api,original]){
    const releases:Array<(value:unknown)=>void>=[];prompt.mockImplementation(()=>new Promise(resolve=>releases.push(resolve)));
    const first=run(module,"remote",{},[],[],true),second=run(module,"remote",{},[],[],true);
    releases[1]("second");assert.equal((await second).params.url,"second");releases[0]("first");assert.equal((await first).params.url,"first");
  }
});

it("Native variants close nested iterators in order on arbitrary prompt rejection",async()=>{
  async function inspect(module:typeof original,failure:unknown){
    const trace:unknown[]=[],data=fixture();
    const variants={*[Symbol.iterator](){try{yield data.variants[0];}finally{trace.push("variants closed");}}};
    data.variants[0].branches[0].requiredFieldIds={*[Symbol.iterator](){try{yield "path";}finally{trace.push("required closed");}}};
    prompt.mockRejectedValue(failure);
    await assert.rejects(module.enforceVariantConstraints({},data.fields,data.dynamic,variants,new Map([["mode","local"]]),new Set(),new Set(),true,[],{}),error=>error===failure);
    return trace;
  }
  for(const failure of [undefined,null,false,17,Symbol("failure"),new Error("failure")])assert.deepEqual(await inspect(api,failure),await inspect(original,failure));
});

it("Native nested lookup preserves own-property traversal, live reducers and special keys",()=>{
  for(const module of [api,original]){
    assert.equal(module.getNestedValue({nested:{value:17}},["nested","value"]),17);
    assert.equal(module.getNestedValue(Object.create({nested:17}),["nested"]),undefined);
    const target=Object.create(null);target.__proto__={value:19};assert.equal(module.getNestedValue(target,["__proto__","value"]),19);
    assert.equal(module.getNestedValue({nested:null},["nested","value"]),undefined);
    const trace:unknown[]=[],path={reduce(callback:(current:unknown,segment:string)=>unknown,initial:unknown){trace.push([callback.name,callback.length,initial]);return callback({value:23},"value");}};
    assert.equal(module.getNestedValue({},path),23);assert.equal(trace.length,1);
  }
  function inspect(module:typeof original){const trace:unknown[]=[],path=new Proxy(["nested","value"],{get(target,key,receiver){trace.push(String(key));return Reflect.get(target,key,receiver);}});return {value:module.getNestedValue({nested:{value:17}},path),trace};}
  assert.deepEqual(inspect(api),inspect(original));
});

it("Native variants preserve malformed-input errors and do not await synchronous branches",async()=>{
  async function outcome(operation:()=>unknown){try{return {value:await operation()};}catch(error){return {error:{name:(error as Error)?.name,message:(error as Error)?.message}};}}
  for(const fields of [null,17,{}])assert.deepEqual(await outcome(()=>api.enforceVariantConstraints({},fields,[],[],new Map(),new Set(),new Set(),false,[],{})),await outcome(()=>original.enforceVariantConstraints({},fields,[],[],new Map(),new Set(),new Set(),false,[],{})));
  async function inspect(module:typeof original){const trace:unknown[]=[],data=fixture(),errors={push(error:unknown){trace.push(error);}};const pending=module.enforceVariantConstraints({},data.fields,data.dynamic,data.variants,new Map(),new Set(),new Set(),false,errors,{});trace.push("returned");await pending;trace.push("done");return trace;}
  assert.deepEqual(await inspect(api),await inspect(original));
});
