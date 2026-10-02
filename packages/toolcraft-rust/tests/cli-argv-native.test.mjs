import assert from "node:assert/strict";
import test from "node:test";
import {loadCLIReference} from "./cli-reference.mjs";
const original=loadCLIReference(["unwrapOptional","splitArrayInput","isNegativeNumericToken","isNextArrayOptionToken","normalizeNumericArrayOptions","resolveHelpOutput","resolveOutput","resolveOutputFromArgv","toDesignSystemOutput","resolveDebugStackMode","getDebugStackModeFromArgv"]);
const native=()=>import("../dist/cli-argv.js");
function outcome(operation){try{return {value:operation()};}catch(error){return {error:{name:error?.name,message:error?.message}};}}

test("CLI array tokens preserve separators, negative numbers and option boundaries",async()=>{
  const api=await native();
  for(const value of [""," ",",,","a, b ,, c",",a,","-1","-1,-2.5", "-1e3, 0x10","--1","-Infinity","-NaN","-","-0","-1,word","漢字,😀,\ud800"]){
    assert.deepEqual(api.splitArrayInput(value),original.splitArrayInput(value));
    assert.equal(api.isNegativeNumericToken(value),original.isNegativeNumericToken(value));
    for(const kind of ["string","number","boolean"])for(const optional of [false,true]){
      const item={kind},schema={kind:"array",item:optional?{kind:"optional",inner:item}:item};
      assert.equal(api.isNextArrayOptionToken(value,schema),original.isNextArrayOptionToken(value,schema));
    }
  }
});

test("CLI numeric array normalization retains aliases, attached values, delimiters and identity",async()=>{
  const api=await native();
  const number={short:"-n",long:"--numbers",required:true},name={short:"-s",long:"--name",required:true},optional={short:"-o",long:"--optional",optional:true},flag={short:"-f",long:"--flag"};
  const options=[number,name,optional,flag],arrays=new Set([number]);
  for(const argv of [[],["--numbers","-1","-2","--flag"],["-n","1","-2,-3","-4.5"],["-n","1","-svalue","-2"],["-n","1","-s","-2","-3"],["-n","1","--","-2"],["-n","1","-","-2"],["-n","1","-bad","-2"],["--numbers=1","-2"],["-n","1","--unknown","-2"],["-o","value","-n","1","-2"],["-o","-n","-1","-2"]])assert.deepEqual(api.normalizeNumericArrayOptions(argv,options,arrays),original.normalizeNumericArrayOptions(argv,options,arrays));
  for(const module of [original,api]){const argv=["-n","-1"];assert.equal(module.normalizeNumericArrayOptions(argv,options,new Set()),argv);}
});

test("CLI output and debug scanners preserve ordering, custom formats and empty slots",async()=>{
  const api=await native(),formats={compact:()=>"",empty:()=>""};
  for(const argv of [[],["--json"],["--md"],["--markdown"],["--output","markdown"],["--output=compact"],["--output","compact"],["--output","invalid","--output=json"],["--output=rich","--json"],["--json","--output=md"],["--output"],[undefined,null,"--output=markdown"],["--output=toString"]]){
    assert.equal(api.resolveOutputFromArgv(argv,formats),original.resolveOutputFromArgv(argv,formats));
    assert.equal(api.resolveHelpOutput(argv),original.resolveHelpOutput(argv));
  }
  for(const flags of [{},{json:true,output:"md"},{json:1,output:"markdown"},{output:null},{output:"compact"}])assert.equal(api.resolveOutput(flags),original.resolveOutput(flags));
  for(const value of [undefined,null,false,true,"trim","raw","md","json","compact"])for(const name of ["toDesignSystemOutput","resolveDebugStackMode"])assert.equal(api[name](value),original[name](value));
  for(const argv of [[],["--debug=raw"],["node","file","--debug","--debug=raw"],["node","file",undefined,"--debug=raw"],["node","file","--debug=trim"]])assert.equal(api.getDebugStackModeFromArgv(argv),original.getDebugStackModeFromArgv(argv));
});

test("CLI scanners retain getter order, callback metadata and arbitrary exceptions",async()=>{
  const api=await native();
  function run(module){
    const trace=[];
    const tracked=(name,value)=>new Proxy(value,{get(target,key){trace.push([name,key]);return target[key];}});
    const option=tracked("option",{long:"--numbers",short:"-n",required:true});
    const options=[option];options.find=function(callback){trace.push(["find",this===options,callback.name,callback.length,arguments.length]);return Array.prototype.find.call(this,callback);};
    const arrays={get size(){trace.push("size");return 1;},get has(){trace.push("has");return function(value){trace.push(["has call",this===arrays,value===option]);return true;};}};
    return {value:module.normalizeNumericArrayOptions(tracked("argv",["--numbers","1","-2"]),options,arrays),trace};
  }
  assert.deepEqual(run(api),run(original));
  function scan(module){const trace=[];const argv=new Proxy(["--output","compact"],{get(target,key){trace.push(key);return target[key];}});return {value:module.resolveOutputFromArgv(argv,{compact:true}),trace};}
  assert.deepEqual(scan(api),scan(original));
  for(const module of [original,api])for(const failure of [undefined,null,17,Symbol("failed")])assert.throws(()=>module.resolveHelpOutput({get length(){throw failure;}}),error=>error===failure);
});

test("CLI scanning preserves live coercion methods and nonboolean method results",async()=>{
  const api=await native();
  function run(module){
    const trace=[];
    const value={get length(){trace.push("length");return 4;},0:" a",1:",",2:{[Symbol.toPrimitive](hint){trace.push(hint);return " b ";}},3:null};
    return {value:module.splitArrayInput(value),trace};
  }
  assert.deepEqual(run(api),run(original));
  for(const module of [original,api])for(const value of [0,"",null,undefined])assert.equal(module.isNextArrayOptionToken({startsWith(){return value;}},{item:{kind:"number"}}),value);
  function numberOrder(module){
    const trace=[],saved=globalThis.Number;
    function number(value){trace.push(["number",value]);return saved(value);}
    Object.defineProperty(number,"isFinite",{get(){trace.push("isFinite");return function(value){trace.push(["finite",this===number,value]);return true;};}});
    globalThis.Number=number;
    try{return {value:module.isNegativeNumericToken("-1,-2"),trace};}finally{globalThis.Number=saved;}
  }
  assert.deepEqual(numberOrder(api),numberOrder(original));
  function output(module){let reads=0;return module.resolveOutput({get output(){return ["first","second","third"][reads++];}});}
  assert.equal(output(api),output(original));
});

test("CLI numeric scanning preserves malformed optional-token diagnostics",async()=>{
  const api=await native();
  const option={long:"--optional",optional:true},args=[["--optional",{length:2,startsWith:0}],[option],new Set([option])];
  assert.deepEqual(outcome(()=>api.normalizeNumericArrayOptions(...args)),outcome(()=>original.normalizeNumericArrayOptions(...args)));
});

test("CLI numeric scanning preserves malformed push diagnostics",async()=>{
  const api=await native(),option={long:"--optional",optional:true};
  const push=Array.prototype.push;
  function run(module){Array.prototype.push=undefined;try{return outcome(()=>module.normalizeNumericArrayOptions(["word"],[],new Set([option])));}finally{Array.prototype.push=push;}}
  assert.deepEqual(run(api),run(original));
});

test("CLI numeric scanning retains empty split results and reentrant method calls",async()=>{
  const api=await native();
  for(const module of [original,api]){
    let calls=0;
    const token={startsWith(prefix){calls++;assert.equal(module.resolveHelpOutput(["--output=json"]),"json");return prefix==="-";},length:0};
    assert.equal(module.isNegativeNumericToken(token),false);assert.equal(calls,2);
  }
  for(const module of [original,api])for(const failure of [undefined,null,false,17,Symbol("numeric")])assert.throws(()=>module.isNegativeNumericToken({startsWith(){throw failure;}}),error=>error===failure);
});
