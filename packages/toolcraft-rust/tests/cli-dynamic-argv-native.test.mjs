import assert from "node:assert/strict";
import test from "node:test";
import {original} from "./cli-dynamic-argv-reference.mjs";
const native=()=>import("../dist/cli-dynamic-argv.js");
function outcome(operation){try{return {value:operation()};}catch(error){return {error:{name:error?.name,message:error?.message}};}}
const field=(id,schema)=>({id,optionPath:[id],displayPath:id,optionPathDisplay:id,schema});
const fields=[field("labels",{kind:"record",value:{kind:"string"}}),field("flags",{kind:"record",value:{kind:"boolean",nullable:true}}),field("jobs",{kind:"array",item:{kind:"object",shape:{name:{kind:"string"},enabled:{kind:"boolean",default:true},tags:{kind:"array",item:{kind:"string"},default:[]}}}})];
function run(module,args,selected=fields){const errors=[];return {result:outcome(()=>module.parseDynamicValues(selected,args,"kebab",errors)),errors};}

test("Dynamic argv composes records, indexed objects, booleans and array values",async()=>{
  const api=await native();
  for(const args of [[],["--labels.name","one"],["--labels.name=one","--labels.name","two"],["--flags.enabled"],["--no-flags.enabled=true"],["--flags.enabled","null"],["--jobs.0.name","one","--jobs.0.tags","a,b","c","--no-jobs.0.enabled"],["--jobs.1.name","one"],["--jobs.0.enabled","false"]])assert.deepEqual(run(api,args),run(original,args));
});

test("Dynamic argv preserves positionals, terminators and exact missing/unknown errors",async()=>{
  const api=await native();
  for(const args of [["position","-3","--","--ignored"],["--labels.name"],["--labels.name=value","position"],["-x"],["--unknown.value","text"],["--jobs.bad.name","text"],["--flags.enabled=bad"],["--no-labels.name","text"],["--","-x","--missing"]])assert.deepEqual(run(api,args),run(original,args));
});

test("Nested CLI assignment defines own data properties and preserves existing containers",async()=>{
  const api=await native();
  for(const path of [[],["value"],["nested","value"],["__proto__","value"],["constructor","prototype","value"],["",null],[undefined,"value"]]){
    function inspect(module){const target={nested:[]};const result=module.setNestedValue(target,path,17);return {target,result,prototype:Object.getPrototypeOf(target)===Object.prototype};}
    assert.deepEqual(inspect(api),inspect(original));
  }
  for(const module of [api,original]){
    const existing={},target={nested:existing};module.setNestedValue(target,["nested","value"],17);assert.equal(target.nested,existing);
    assert.deepEqual(Object.getOwnPropertyDescriptor(existing,"value"),{value:17,writable:true,enumerable:true,configurable:true});
  }
});

test("Dynamic argv preserves input access and field getter order",async()=>{
  const api=await native();
  function inspect(module){
    const trace=[];
    const selected=fields.slice(0,1).map(value=>new Proxy(value,{get(target,key){trace.push(["field",key]);return target[key];}}));
    const args=new Proxy(["--labels.name","one","position"],{get(target,key){trace.push(["argv",key]);return target[key];}});
    return {value:run(module,args,selected),trace};
  }
  assert.deepEqual(inspect(api),inspect(original));
});

test("Dynamic argv preserves live Map and Set construction and method order",async()=>{
  const api=await native(),OriginalMap=globalThis.Map,OriginalSet=globalThis.Set;
  function inspect(module){
    const trace=[];
    class TrackedMap extends OriginalMap {
      constructor(...args){super(...args);trace.push(["Map",args.length]);}
      get(key){trace.push(["get",key]);return super.get(key);}
      set(key,value){trace.push(["set",key]);return super.set(key,value);}
      has(key){trace.push(["has",key]);return super.has(key);}
    }
    class TrackedSet extends OriginalSet {constructor(...args){super(...args);trace.push(["Set",args.length]);}add(value){trace.push(["add",value]);return super.add(value);}}
    globalThis.Map=TrackedMap;globalThis.Set=TrackedSet;
    try{const value=module.parseDynamicValues(fields.slice(0,1),["--labels.name","one"],"kebab",[]);return {ids:[...value.providedFieldIds],values:[...value.values],positionals:value.positionals,trace};}finally{globalThis.Map=OriginalMap;globalThis.Set=OriginalSet;}
  }
  assert.deepEqual(inspect(api),inspect(original));
});

test("Nested CLI writes preserve live ownership and definition operations",async()=>{
  const api=await native(),own=Object.prototype.hasOwnProperty,define=Object.defineProperty;
  function inspect(module){
    const trace=[],nested={},target=Object.create({nested});
    Object.prototype.hasOwnProperty=function(key){if(this===target){trace.push(["own",key]);return "present";}return own.call(this,key);};
    Object.defineProperty=function(object,key,descriptor){if(object===nested)trace.push(["define",this===Object,key,{...descriptor}]);return define(object,key,descriptor);};
    try{module.setNestedValue(target,["nested","value"],17);return {nested,trace};}finally{Object.prototype.hasOwnProperty=own;Object.defineProperty=define;}
  }
  assert.deepEqual(inspect(api),inspect(original));
});

test("Dynamic argv preserves label replacement and final Map constructor lookup",async()=>{
  const api=await native(),replace=String.prototype.replace,OriginalMap=globalThis.Map;
  function inspect(module){
    const trace=[],selected=fields.slice(0,1);
    selected.filter=function(callback){trace.push(["filter",callback.name,callback.length]);globalThis.Map=function(){throw new Error("late Map lookup");};return Array.prototype.filter.call(this,callback);};
    String.prototype.replace=function(pattern,replacement){trace.push(["replace",String(this),pattern.source,pattern.flags,replacement]);return replace.call(this,pattern,replacement);};
    try{const value=module.parseDynamicValues(selected,["--labels.name=value"],"kebab",[]);return {values:[...value.values],trace};}finally{String.prototype.replace=replace;globalThis.Map=OriginalMap;}
  }
  assert.deepEqual(inspect(api),inspect(original));
});

test("Dynamic argv preserves malformed errors, reentrancy and arbitrary throws",async()=>{
  const api=await native();
  const cases=[
    module=>module.parseDynamicValues([],null,"kebab",[]),
    module=>module.parseDynamicValues(null,[],"kebab",[]),
    module=>module.parseDynamicValues(fields,[17],"kebab",[]),
    module=>module.setNestedValue(null,["value"],17),
    module=>module.setNestedValue({},null,17),
    module=>module.setNestedValue(Object.freeze({}),["value"],17)
  ];
  for(const operation of cases)assert.deepEqual(outcome(()=>operation(api)),outcome(()=>operation(original)));
  for(const module of [api,original])for(const failure of [undefined,null,false,17,Symbol("failure")]){
    const args=["--"];args.slice=()=>({[Symbol.iterator](){throw failure;}});
    assert.throws(()=>module.parseDynamicValues(fields,args,"kebab",[]),error=>error===failure);
    const target={get nested(){throw failure;}};
    assert.throws(()=>module.setNestedValue(target,["nested","value"],17),error=>error===failure);
  }
  for(const module of [api,original]){
    const nested={},target={get nested(){assert.deepEqual(module.parseDynamicValues([],[],"kebab",[]).positionals,[]);return nested;}};
    module.setNestedValue(target,["nested","value"],17);assert.equal(nested.value,17);
  }
});
