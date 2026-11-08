import assert from "node:assert/strict";
import test from "node:test";
import {unicodeLength as original} from "../../toolcraft-schema/dist/index.js";
import {unicodeLength as native} from "../dist/index.js";
function outcome(operation){try{return {value:operation()};}catch(error){return {error:{name:error?.name,message:error?.message}};}}

test("Unicode length preserves primitive, boxed and arbitrary iterable inputs",()=>{
  for(const value of ["","ascii","😀漢字\ud800",new String("😀hello"),[undefined,17,Symbol("value")],new Set([1,2]),{*[Symbol.iterator](){yield "many characters";yield null;}}])assert.equal(native(value),original(value));
  for(const value of [null,undefined,false,17,{}, {length:3}])assert.deepEqual(outcome(()=>native(value)),outcome(()=>original(value)));
  assert.equal(native.name,original.name);assert.equal(native.length,original.length);
});

test("Unicode length preserves iterator access order, receivers and arbitrary throws",()=>{
  function run(api,failureAt){
    const trace=[];let position=0;
    const iterator={
      get next(){
        trace.push("next");
        return function(){
          trace.push(["call",this===iterator]);
          if(failureAt==="next")throw 17;
          const current=position++;
          return {
            get done(){trace.push(["done",current]);if(failureAt==="done")throw false;return current===2;},
            get value(){trace.push(["value",current]);if(failureAt==="value")throw null;return "x";}
          };
        };
      },
      return(){trace.push("return");return {done:true};}
    };
    const value={get [Symbol.iterator](){trace.push("iterator");return function(){trace.push(["start",this===value]);return iterator;};}};
    return {result:outcome(()=>api(value)),trace};
  }
  for(const failureAt of [undefined,"next","done","value"])assert.deepEqual(run(native,failureAt),run(original,failureAt));
  for(const api of [original,native])for(const failure of [undefined,null,false,17,Symbol("failure")])assert.throws(()=>api({get [Symbol.iterator](){throw failure;}}),error=>error===failure);
});

test("Unicode length observes replacement string iterators and reentrant iteration",()=>{
  const descriptor=Object.getOwnPropertyDescriptor(String.prototype,Symbol.iterator);
  function run(api){
    const trace=[];
    Object.defineProperty(String.prototype,Symbol.iterator,{configurable:true,get(){trace.push(String(this));return function*(){trace.push(String(this));yield "first";yield "second";};}});
    try{return {result:api("ordinary string"),trace};}finally{Object.defineProperty(String.prototype,Symbol.iterator,descriptor);}
  }
  assert.deepEqual(run(native),run(original));
  for(const api of [original,native]){const value={*[Symbol.iterator](){assert.equal(api("😀"),1);yield 1;}};assert.equal(api(value),1);}
});
