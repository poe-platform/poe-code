import assert from "node:assert/strict";
import test from "node:test";
import {original} from "./cli-dynamic-values-reference.mjs";
const native=()=>import("../dist/cli-dynamic-values.js");
function outcome(operation){try{return {value:operation()};}catch(error){return {error:{name:error?.name,message:error?.message}};}}
function run(module,schema,value,path="config"){const errors=[];return {result:outcome(()=>module.finalizeDynamicValue(schema,value,path,errors)),errors};}

test("Dynamic CLI values preserve primitives, nullability, JSON validation and unsupported kinds",async()=>{
  const api=await native();
  for(const schema of [{kind:"string"},{kind:"number"},{kind:"boolean"},{kind:"enum"},{kind:"json"},{kind:"json",const:{value:1}},{kind:"json",enum:[1,2],nullable:true},{kind:"union"},{kind:"oneOf"}])for(const value of [undefined,null,true,"value",17,{value:1},()=>1])assert.deepEqual(run(api,schema,value),run(original,schema,value));
  const value={owned:true};assert.equal(api.finalizeDynamicValue({kind:"json"},value,"config",[]),value);
});

test("Dynamic CLI values assemble objects and records with defaults and required fields",async()=>{
  const api=await native();
  const schema={kind:"object",shape:{name:{kind:"string"},optional:{kind:"optional",inner:{kind:"number"}},settings:{kind:"json",default:{retries:[1,2]}}}};
  for(const value of [undefined,null,17,[],{},Object.create(null),{name:"value",extra:true},{name:null,optional:3},{settings:{custom:true}}])assert.deepEqual(run(api,schema,value),run(original,schema,value));
  for(const module of [api,original]){const value=module.finalizeDynamicValue(schema,{name:"value"},"",[]);assert.notEqual(value.settings,schema.shape.settings.default);assert.notEqual(value.settings.retries,schema.shape.settings.default.retries);}
  const record={kind:"record",value:schema};
  for(const value of [null,[],{}, {first:{name:"one"},second:{}}])assert.deepEqual(run(api,record,value),run(original,record,value));
});

test("Dynamic CLI indexed objects become arrays with exact index diagnostics",async()=>{
  const api=await native();
  const schema={kind:"array",item:{kind:"optional",inner:{kind:"object",shape:{name:{kind:"string"}}}}};
  for(const value of [undefined,null,[],{}, {0:{name:"zero"},1:{name:"one"}},{1:{name:"one"}},{0:{},2:{}},{"-1":{}},{"1.5":{}},{bad:{}},{"00":{name:"zero"}},{"":{name:"zero"}}])assert.deepEqual(run(api,schema,value),run(original,schema,value));
  const scalar={kind:"array",item:{kind:"number"}},value={0:"unchanged"};assert.equal(api.finalizeDynamicValue(scalar,value,"values",[]),value);
});

test("Dynamic field issues preserve path filtering, fallback and descriptor order",async()=>{
  const api=await native();
  for(const path of [[],[""],["name"],[0,"",2]])for(const prefix of ["","config"])assert.deepEqual(api.formatFieldValidationIssue({path,message:"invalid"},prefix),original.formatFieldValidationIssue({path,message:"invalid"},prefix));
  function inspect(module){const trace=[];const issue={get path(){trace.push("path");return ["name"];},get message(){trace.push("message");return "invalid";}};return {result:module.formatFieldValidationIssue(issue,"config"),trace};}
  assert.deepEqual(inspect(api),inspect(original));
});

test("Dynamic object defaults preserve computed-key and repeated getter ordering",async()=>{
  const api=await native(),entries=Object.entries;
  function inspect(module){
    const trace=[],shape={};let defaults=0;
    const key={[Symbol.toPrimitive](hint){trace.push(["key",hint]);return "field";}};
    const child={kind:"json",get default(){trace.push(["default",++defaults]);return {version:defaults};}};
    Object.entries=function(value){if(value===shape)return [[key,child]];return entries(value);};
    try{return {result:module.finalizeDynamicValue({kind:"object",shape},{},"",[]),trace};}finally{Object.entries=entries;}
  }
  assert.deepEqual(inspect(api),inspect(original));
});

test("Dynamic values preserve object setters and record own-property construction",async()=>{
  const api=await native();
  function inspect(module,record){
    const descriptor=Object.getOwnPropertyDescriptor(Object.prototype,"dynamicTestField"),trace=[];
    try{
      Object.defineProperty(Object.prototype,"dynamicTestField",{configurable:true,set(value){trace.push(value);}});
      const schema=record?{kind:"record",value:{kind:"string"}}:{kind:"object",shape:{dynamicTestField:{kind:"string"}}};
      const result=module.finalizeDynamicValue(schema,{dynamicTestField:"value"},"config",[]);
      return {result,trace};
    }finally{if(descriptor)Object.defineProperty(Object.prototype,"dynamicTestField",descriptor);else delete Object.prototype.dynamicTestField;}
  }
  for(const record of [false,true])assert.deepEqual(inspect(api,record),inspect(original,record));
  for(const module of [api,original]){
    const input=Object.fromEntries([["__proto__",{owned:true}]]);
    const result=module.finalizeDynamicValue({kind:"record",value:{kind:"json"}},input,"config",[]);
    assert.equal(Object.getPrototypeOf(result),Object.prototype);assert.equal(Object.hasOwn(result,"__proto__"),true);assert.equal(result.__proto__,input.__proto__);
  }
});

test("Dynamic arrays preserve live integer and collection callbacks",async()=>{
  const api=await native(),integer=Number.isInteger,sort=Array.prototype.sort,some=Array.prototype.some;
  function inspect(module){
    const trace=[],schema={kind:"array",item:{kind:"object",shape:{name:{kind:"string"}}}};
    Number.isInteger=function(value){trace.push(["integer",this===Number,value]);return "accepted";};
    Array.prototype.sort=function(callback){trace.push(["sort",callback.name,callback.length,callback(1,0)]);return sort.call(this,callback);};
    Array.prototype.some=function(callback){trace.push(["some",callback.name,callback.length]);return some.call(this,callback);};
    try{return {result:module.finalizeDynamicValue(schema,{1:{name:"one"},0:{name:"zero"}},"jobs",[]),trace};}finally{Number.isInteger=integer;Array.prototype.sort=sort;Array.prototype.some=some;}
  }
  assert.deepEqual(inspect(api),inspect(original));
});

test("Dynamic values preserve iterator cleanup, malformed errors and reentrancy",async()=>{
  const api=await native(),entries=Object.entries;
  for(const module of [api,original])for(const failure of [undefined,null,false,17,Symbol("failure")]){
    const shape={},trace=[];
    Object.entries=function(value){if(value!==shape)return entries(value);return {*[Symbol.iterator](){try{yield ["field",{get kind(){throw failure;}}];}finally{trace.push("closed");}}};};
    try{assert.throws(()=>module.finalizeDynamicValue({kind:"object",shape},{},"config",[]),error=>error===failure);assert.deepEqual(trace,["closed"]);}finally{Object.entries=entries;}
  }
  const cases=[
    module=>module.finalizeDynamicValue(null,undefined,"config",[]),
    module=>module.finalizeDynamicValue({kind:"object",shape:null},{},"config",[]),
    module=>module.finalizeDynamicValue({kind:"object",shape:{field:{kind:"string"}}},{},"config",null),
    module=>module.formatFieldValidationIssue({path:null,message:"invalid"},"config")
  ];
  for(const operation of cases)assert.deepEqual(outcome(()=>operation(api)),outcome(()=>operation(original)));
  for(const module of [api,original]){
    const schema={kind:"object",shape:{value:{kind:"string"}}},value={get value(){assert.deepEqual(module.finalizeDynamicValue({kind:"record",value:{kind:"number"}},{nested:1},"",[]),{nested:1});return "value";}};
    assert.deepEqual(module.finalizeDynamicValue(schema,value,"config",[]),{value:"value"});
  }
});
