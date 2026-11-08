import assert from "node:assert/strict";
import test from "node:test";
import {original} from "./cli-values-reference.mjs";
const native=()=>import("../dist/cli-values.js");
function outcome(operation){try{return {value:operation()};}catch(error){return {error:{name:error?.name,message:error?.message}};}}

test("CLI scalar values preserve nullable, boolean, numeric and enum policies",async()=>{
  const api=await native();
  for(const schema of [{kind:"boolean"},{kind:"boolean",nullable:true},{kind:"number"},{kind:"number",minimum:-2,maximum:3,jsonType:"integer"},{kind:"number",nullable:true},{kind:"enum",values:["compact","full",false,17,null]},{kind:"enum",values:[]},{kind:"json"}])for(const value of ["","  ","true"," FALSE ","null","-0","-2","3.5","0x10","Infinity","17","full","ful","unknown"]){
    assert.deepEqual(outcome(()=>api.parseScalarValue(value,schema,"value")),outcome(()=>original.parseScalarValue(value,schema,"value")));
  }
  assert.equal(Object.is(api.parseScalarValue("-0",{kind:"number"},"value"),-0),true);
});

test("CLI string values preserve Unicode bounds, patterns and boxed value identity",async()=>{
  const api=await native();
  for(const schema of [{kind:"string"},{kind:"string",minLength:2,maxLength:4},{kind:"string",pattern:"^a+$"},{kind:"string",pattern:"["},{kind:"string",nullable:true}])for(const value of ["","a","aaa","漢😀","\ud800","null",new String("aaa")]){
    assert.deepEqual(outcome(()=>api.parseScalarValue(value,schema,"name")),outcome(()=>original.parseScalarValue(value,schema,"name")));
  }
  const value=new String("😀");assert.equal(api.validateStringPattern(value,{kind:"string",minLength:1,maxLength:1},"name"),value);
});

test("CLI array values preserve scalar coercion, optional items, nullable arrays and bounds",async()=>{
  const api=await native();
  for(const item of [{kind:"number"},{kind:"boolean"},{kind:"string"},{kind:"enum",values:["a","b"]},{kind:"array"},{kind:"object"},{kind:"json"}])for(const optional of [false,true])for(const nullable of [false,true])for(const value of [""," , ","1, 2,,3","a, b","true, false","null"]){
    const schema={kind:"array",item:optional?{kind:"optional",inner:item}:item,nullable};
    assert.deepEqual(outcome(()=>api.parseArrayValue(value,schema,"items")),outcome(()=>original.parseArrayValue(value,schema,"items")));
  }
  for(const schema of [{},{minItems:2},{maxItems:2},{minItems:2,maxItems:3},{minItems:null,maxItems:"2"}])for(const value of [[],[1],[1,2],[1,2,3,4]])assert.deepEqual(outcome(()=>api.validateArrayBounds(value,schema,"items")),outcome(()=>original.validateArrayBounds(value,schema,"items")));
});

test("CLI received-value and JSON diagnostics preserve truncation and original errors",async()=>{
  const api=await native();
  for(const value of [undefined,null,false,17,NaN,1n,Symbol("value"),()=>1,{},[],[1,2],"a".repeat(41),"a".repeat(39)+"😀"]){
    assert.deepEqual(outcome(()=>api.describeReceived(value)),outcome(()=>original.describeReceived(value)));
    assert.deepEqual(outcome(()=>api.parseJsonText(value,"data")),outcome(()=>original.parseJsonText(value,"data")));
  }
  for(const value of ["{","[1,]","{\"a\":1}","null","true","[1,2]","\"😀\""])assert.deepEqual(outcome(()=>api.parseJsonText(value,"data")),outcome(()=>original.parseJsonText(value,"data")));
  for(const schema of [{kind:"string"},{kind:"enum",values:["a",17,null]}])assert.equal(api.formatMissingParameterMessage({displayPath:"value",schema}),original.formatMissingParameterMessage({displayPath:"value",schema}));
});

test("CLI value parsers preserve getter and coercion order and arbitrary throws",async()=>{
  const api=await native();
  function run(module,kind){
    const trace=[];
    const schema=new Proxy({kind,values:["yes","no"],minimum:2,maximum:4,minLength:2,maxLength:4,pattern:"^x+$"},{get(target,key){trace.push(["schema",key]);return target[key];}});
    const label={[Symbol.toPrimitive](hint){trace.push(["label",hint]);return "label";}};
    return {value:outcome(()=>module.parseScalarValue("bad",schema,label)),trace};
  }
  for(const kind of ["string","number","boolean","enum"])assert.deepEqual(run(api,kind),run(original,kind));
  for(const module of [original,api])for(const failure of [undefined,null,false,17,Symbol("failure")])assert.throws(()=>module.parseScalarValue("x",{get kind(){throw failure;}},"name"),error=>error===failure);
});

test("CLI JSON error handling preserves catch boundaries and diagnostic evaluation order",async()=>{
  const api=await native(),parse=JSON.parse;
  function run(module,failure){
    const trace=[],label={[Symbol.toPrimitive](hint){trace.push(["label",hint]);return "data";}};
    JSON.parse=function(value){trace.push(["parse",this===JSON,value]);throw failure;};
    try{return {value:outcome(()=>module.parseJsonText("{",label)),trace};}finally{JSON.parse=parse;}
  }
  for(const failure of [undefined,null,false,17,Symbol("failure"),new Error("parse failed")])assert.deepEqual(run(api,failure),run(original,failure));
  for(const module of [original,api]){
    const failure={owned:true},error=new Error("parse failed");Object.defineProperty(error,"message",{get(){throw failure;}});
    JSON.parse=()=>{throw error;};
    try{assert.throws(()=>module.parseJsonText("{","data"),value=>value===failure);}finally{JSON.parse=parse;}
  }
});

test("CLI pattern checks retain constructor and test calls, coercion and arbitrary results",async()=>{
  const api=await native(),RegExpConstructor=globalThis.RegExp;
  function run(module,result){
    const trace=[];
    globalThis.RegExp=function(pattern){trace.push(["construct",new.target===globalThis.RegExp,pattern]);const patternObject={get test(){trace.push("test");return function(value){trace.push(["call",this===patternObject,value]);return result;};}};return patternObject;};
    try{return {value:outcome(()=>module.validateStringPattern("abc",{kind:"string",pattern:"pattern"},"text")),trace};}finally{globalThis.RegExp=RegExpConstructor;}
  }
  for(const result of [false,true,undefined,0,"accepted"])assert.deepEqual(run(api,result),run(original,result));
});

test("CLI arrays and enum matches preserve custom collection callbacks and identity",async()=>{
  const api=await native(),map=Array.prototype.map;
  function run(module){
    const trace=[];
    const values=["a","b"];
    values.find=function(callback){trace.push(["find",this===values,callback.name,callback.length,arguments.length]);return Array.prototype.find.call(this,callback);};
    const enumeration=module.parseEnumValue("b",values,"mode");
    const mapped={owned:true};
    Array.prototype.map=function(callback){trace.push(["map",callback.name,callback.length,arguments.length,callback("true")]);return mapped;};
    try{const value=module.parseArrayValue("true,false",{kind:"array",item:{kind:"boolean"}},"items");assert.equal(value,mapped);return {enumeration,trace};}finally{Array.prototype.map=map;}
  }
  assert.deepEqual(run(api),run(original));
  function bounds(module){
    const trace=[];let reads=0;
    const value={get length(){trace.push("length");return 1;}},schema={get minItems(){trace.push(["minItems",++reads]);return reads===1?0:3;}};
    const label={[Symbol.toPrimitive](hint){trace.push(["label",hint]);return "items";}};
    return {value:outcome(()=>module.validateArrayBounds(value,schema,label)),trace};
  }
  assert.deepEqual(bounds(api),bounds(original));
});

test("CLI value parser callbacks support reentrancy and preserve malformed method errors",async()=>{
  const api=await native();
  for(const module of [original,api]){
    const value={trim(){assert.equal(module.parseScalarValue("17",{kind:"number"},"value"),17);return "TRUE";}};
    assert.equal(module.parseBooleanText(value,"flag"),true);
  }
  for(const value of [null,17,{trim:0},{trim(){return {toLowerCase:0};}}])assert.deepEqual(outcome(()=>api.parseBooleanText(value,"flag")),outcome(()=>original.parseBooleanText(value,"flag")));
  for(const values of [null,{find:0},{find(){return undefined;},map:0}])assert.deepEqual(outcome(()=>api.parseEnumValue("yes",values,"mode")),outcome(()=>original.parseEnumValue("yes",values,"mode")));
});
