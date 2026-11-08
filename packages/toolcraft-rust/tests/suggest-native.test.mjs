import assert from "node:assert/strict";
import test from "node:test";
import {suggest as original} from "../../toolcraft/dist/suggest.js";
import {suggest as native} from "../dist/index.js";
function outcome(operation){try{return {value:operation()};}catch(error){return {error:{name:error?.name,message:error?.message}};}}

test("suggestions expose complete distance records to custom collection methods",()=>{
  function run(api){
    const trace=[],candidates=["full","compact"];
    candidates.map=function(callback){trace.push([callback.name,callback.length,arguments.length]);const rows=Array.prototype.map.call(this,callback);trace.push(rows.map(row=>({...row})));return rows;};
    return {result:api("ful",candidates),trace};
  }
  assert.deepEqual(run(native),run(original));
});

test("suggestions preserve boxed strings and indexed source reads",()=>{
  // eslint-disable-next-line no-sparse-arrays -- Sparse candidates must retain map semantics.
  for(const input of ["",new String("ful"),"漢字","😀\ud800"])for(const candidates of [["full","compact"],[new String("full"),"compact"],[,"full",,"ful"]])assert.deepEqual(outcome(()=>native(input,candidates)),outcome(()=>original(input,candidates)));
  function run(api){
    const trace=[];
    const input=new Proxy({length:2,0:"a",1:"b"},{get(target,key){trace.push(["input",key]);return target[key];}});
    const candidate=new Proxy({length:2,0:"b",1:"a",localeCompare(){return 0;}},{get(target,key){trace.push(["candidate",key]);return target[key];}});
    const result=api(input,[candidate],{threshold:2});assert.equal(result[0],candidate);return trace;
  }
  assert.deepEqual(run(native),run(original));
});

test("suggestion distance construction preserves live Array and Math methods",()=>{
  const from=Array.from,min=Math.min;
  function run(api){
    const trace=[];
    Array.from=function(value,callback){trace.push(["from",this===Array,value.length,callback.name,callback.length,arguments.length]);return from.call(this,value,callback);};
    Math.min=function(...values){trace.push(["min",this===Math,...values]);return min(...values);};
    try{return {result:api("ab",["ba"],{threshold:2}),trace};}finally{Array.from=from;Math.min=min;}
  }
  assert.deepEqual(run(native),run(original));
});

test("suggestions preserve matrix access and assignment order",()=>{
  const from=Array.from;
  function run(api){
    const trace=[];let allocation=0;
    Array.from=function(...args){const id=allocation++;const value=from.apply(this,args);return new Proxy(value,{get(target,key){trace.push(["get",id,key]);return target[key];},set(target,key,value){trace.push(["set",id,key,value]);target[key]=value;return true;}});};
    try{return {result:api("ab",["ba"],{threshold:2}),trace};}finally{Array.from=from;}
  }
  assert.deepEqual(run(native),run(original));
});

test("suggestion sort callbacks preserve repeated distance reads and strict comparison",()=>{
  function run(api,first,second){
    const trace=[];let reads=0;
    const left={get distance(){trace.push("left distance");return reads++===0?first:5;},get candidate(){trace.push("left candidate");return {localeCompare(value){trace.push(["locale",value]);return -1;}};}};
    const right={get distance(){trace.push("right distance");return second;},get candidate(){trace.push("right candidate");return "right";}};
    const candidates={map(){return {filter(){return {sort(compare){const value=compare(left,right);return {slice(){return {map(){return value;}};}};}};}};}};
    return {result:api("value",candidates),trace};
  }
  for(const [first,second]of [[1,2],[NaN,NaN],[0,-0],[1,1],["1",1]])assert.deepEqual(run(native,first,second),run(original,first,second));
});

test("suggestions retain live options, malformed sources, arbitrary throws and reentrancy",()=>{
  for(const args of [[null,[]],["a",null],["a",{map:0}],["a",[null]],["a",[17]],["a",["a"],null]])assert.deepEqual(outcome(()=>native(...args)),outcome(()=>original(...args)));
  // eslint-disable-next-line no-sparse-arrays -- Sparse candidates must retain map semantics.
  for(const input of ["","ab","漢字","😀\ud800"])for(const candidates of [["ba","ab","abc"],[,"ab",,"ba"]])for(const opts of [{},{max:0},{max:-1},{max:1.5},{threshold:0},{threshold:NaN}])assert.deepEqual(native(input,candidates,opts),original(input,candidates,opts));
  for(const api of [original,native]){
    let nested=false;
    const opts={get max(){if(!nested){nested=true;assert.deepEqual(api("",[]),[]);}return 1;}};
    assert.deepEqual(api("a",["a"],opts),["a"]);
    for(const failure of [undefined,null,false,17,Symbol("failure")])assert.throws(()=>api("x",[{get length(){throw failure;}}]),error=>error===failure);
  }
  assert.equal(native.name,original.name);assert.equal(native.length,original.length);
});
