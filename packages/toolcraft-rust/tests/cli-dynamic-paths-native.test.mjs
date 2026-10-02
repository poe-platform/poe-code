import assert from "node:assert/strict";
import test from "node:test";
import {original} from "./cli-dynamic-paths-reference.mjs";
const native=()=>import("../dist/cli-dynamic-paths.js");
function outcome(operation){try{return {value:operation()};}catch(error){return {error:{name:error?.name,message:error?.message}};}}

test("Dynamic CLI paths preserve objects, records, arrays and original leaf identity",async()=>{
  const api=await native();
  const name={kind:"string"},count={kind:"number"};
  const schema={kind:"object",shape:{userName:name,HTTPCount:{kind:"optional",inner:count},records:{kind:"record",value:{kind:"object",shape:{userName:name}}},items:{kind:"array",item:{kind:"optional",inner:{kind:"object",shape:{userName:name}}}}}};
  for(const casing of ["kebab","snake"])for(const segments of [["user-name"],["user_name"],["http-count"],["http_count"],["records","__proto__","user-name"],["items","00","user-name"],["items","1","user_name"],["items"],["missing"],[],["records"],["items","x"],["user-name","extra"]]){
    assert.deepEqual(outcome(()=>api.resolveDynamicLeaf(schema,segments,casing,[],[],"config")),outcome(()=>original.resolveDynamicLeaf(schema,segments,casing,[],[],"config")));
  }
  assert.equal(api.resolveDynamicLeaf(schema,["user-name"],"kebab").schema,name);
  const path=["unchanged"];
  assert.equal(api.resolveDynamicLeaf(name,[],"kebab",path).path,path);
});

test("Dynamic CLI paths preserve unsupported shapes, numeric selectors and qualification",async()=>{
  const api=await native();
  for(const kind of ["string","number","boolean","enum","array","json","object","record","oneOf","union"])for(const segments of [[],["value"]]){
    const schema={kind,shape:{},item:{kind:"string"},value:{kind:"string"}};
    assert.deepEqual(outcome(()=>api.resolveDynamicLeaf(schema,segments,"kebab",["parent"],["Parent"],"root")),outcome(()=>original.resolveDynamicLeaf(schema,segments,"kebab",["parent"],["Parent"],"root")));
  }
  for(const selector of ["","0","00","42","-1","1.5","１","😀",new String("23"),["1","2"]])assert.equal(api.isNumericFixtureSelector(selector),original.isNumericFixtureSelector(selector));
  for(const prefix of ["","root"])for(const path of ["","item"])assert.equal(api.qualifyDisplayPath(prefix,path),original.qualifyDisplayPath(prefix,path));
});

test("Dynamic CLI option selection prefers longest matching paths and preserves fields",async()=>{
  const api=await native();
  const short={id:"short",optionPath:["config"],displayPath:"config",schema:{kind:"record",value:{kind:"string"}}};
  const long={id:"long",optionPath:["config","userData"],displayPath:"config.userData",schema:{kind:"record",value:{kind:"number"}}};
  const fields=[short,long];
  for(const casing of ["kebab","snake"])for(const flag of ["config","config.name","config.user-data.count","config.user_data.count","other.name","config."]){
    assert.deepEqual(outcome(()=>api.resolveDynamicOption(fields,flag,casing)),outcome(()=>original.resolveDynamicOption(fields,flag,casing)));
  }
  assert.equal(api.resolveDynamicOption(fields,"config.user-data.count","kebab").match,long);
  assert.deepEqual(fields,[short,long]);
});

test("Dynamic CLI path resolution preserves schema and path accessor order",async()=>{
  const api=await native();
  function run(module){
    const trace=[];
    const tracked=(name,value)=>new Proxy(value,{get(target,key){trace.push([name,key]);return target[key];}});
    const schema=tracked("schema",{kind:"object",shape:tracked("shape",{userName:tracked("leaf",{kind:"string"})})});
    const segments=tracked("segments",["user-name"]);
    const result=module.resolveDynamicLeaf(schema,segments,"kebab",tracked("output",[]),tracked("display",[]),"config");
    return {path:result.path,displayPath:result.displayPath,trace};
  }
  assert.deepEqual(run(api),run(original));
});

test("Dynamic CLI traversal preserves custom entry iterators and early cleanup",async()=>{
  const api=await native(),entries=Object.entries;
  function run(module){
    const trace=[],leaf={kind:"string"},shape={value:leaf};
    Object.entries=function(value){if(value!==shape)return entries(value);trace.push("entries");return {*[Symbol.iterator](){try{trace.push("start");yield ["value",leaf];trace.push("unused");yield ["other",leaf];}finally{trace.push("closed");}}};};
    try{return {result:module.resolveDynamicLeaf({kind:"object",shape},["value"],"kebab"),trace};}finally{Object.entries=entries;}
  }
  assert.deepEqual(run(api),run(original));
});

test("Dynamic selectors preserve character coercion, iterator cleanup and reentrancy",async()=>{
  const api=await native();
  function run(module,bad){
    const trace=[];
    const char={[Symbol.toPrimitive](hint){trace.push(["coerce",hint]);assert.equal(module.isNumericFixtureSelector("2"),true);return bad?"x":"4";}};
    const value={get length(){trace.push("length");return 1;},*[Symbol.iterator](){try{trace.push("iterate");yield char;trace.push("complete");}finally{trace.push("closed");}}};
    return {result:module.isNumericFixtureSelector(value),trace};
  }
  for(const bad of [false,true])assert.deepEqual(run(api,bad),run(original,bad));
  for(const value of [[undefined],[null],{length:1,*[Symbol.iterator](){yield NaN;} }])assert.equal(api.isNumericFixtureSelector(value),original.isNumericFixtureSelector(value));
});

test("Dynamic option selection preserves live sort, map and find callback behavior",async()=>{
  const api=await native(),sort=Array.prototype.sort,find=Array.prototype.find;
  function run(module){
    const trace=[],field={id:"field",optionPath:["config"],displayPath:"config",schema:{kind:"record",value:{kind:"string"}}};
    field.optionPath.map=function(callback){trace.push(["map",callback.name,callback.length,arguments.length]);return Array.prototype.map.call(this,callback);};
    Array.prototype.sort=function(callback){trace.push(["sort",callback.name,callback.length,arguments.length,callback(field,field)]);return this;};
    Array.prototype.find=function(callback){trace.push(["find",callback.name,callback.length,arguments.length,callback(field)]);return field;};
    try{const selected=module.resolveDynamicOption([field],"config.value","kebab");return {same:selected.match===field,path:selected.leaf.path,trace};}finally{Array.prototype.sort=sort;Array.prototype.find=find;}
  }
  assert.deepEqual(run(api),run(original));
});

test("Dynamic path helpers preserve malformed inputs and arbitrary thrown identity",async()=>{
  const api=await native();
  const cases=[
    module=>module.resolveDynamicLeaf(null,[],"kebab"),
    module=>module.resolveDynamicLeaf({kind:"object",shape:{}},{length:1},"kebab"),
    module=>module.resolveDynamicLeaf({kind:"record",value:{kind:"string"}},["key"],"kebab",null),
    module=>module.resolveDynamicLeaf({kind:"record",value:{kind:"string"}},["key"],"kebab",[],null),
    module=>module.resolveDynamicLeaf({kind:"array",item:{kind:"string"}},["0"],"kebab",[],{}),
    module=>module.resolveDynamicOption(null,"config.value","kebab"),
    module=>module.resolveDynamicOption([],null,"kebab"),
    module=>module.qualifyDisplayPath(null,"value"),
    module=>module.isNumericFixtureSelector(null)
  ];
  for(const operation of cases)assert.deepEqual(outcome(()=>operation(api)),outcome(()=>operation(original)));
  for(const module of [api,original])for(const failure of [undefined,null,false,17,Symbol("failure")]){
    assert.throws(()=>module.resolveDynamicLeaf({get kind(){throw failure;}},[],"kebab"),error=>error===failure);
    assert.throws(()=>module.isNumericFixtureSelector({length:1,[Symbol.iterator](){throw failure;}}),error=>error===failure);
  }
});
