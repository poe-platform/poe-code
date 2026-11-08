import assert from "node:assert/strict";
import test from "node:test";
import * as original from "../../toolcraft/dist/number-schema.js";
const native=()=>import("../dist/number-schema.js");

test("numeric schema helpers preserve value admission, bounds and descriptions",async()=>{
  const api=await native();
  assert.deepEqual(Object.keys(api),Object.keys(original));
  for(const name of Object.keys(api)){assert.equal(api[name].name,original[name].name);assert.equal(api[name].length,original[name].length);}
  for(const schema of [{},{jsonType:"integer"},{minimum:0},{maximum:3},{jsonType:"integer",minimum:-2,maximum:3},{minimum:Infinity,maximum:-Infinity},{minimum:null,maximum:"3"},{minimum:NaN},{minimum:1n}]){
    assert.equal(api.getExpectedNumberDescription(schema),original.getExpectedNumberDescription(schema));
    for(const value of [undefined,null,false,0,-0,1.5,-2,3,4,NaN,Infinity,-Infinity,"1",1n,Symbol("value"),{},new Number(1)])assert.equal(api.isValidNumberSchemaValue(value,schema),original.isValidNumberSchemaValue(value,schema));
  }
});

test("numeric schema helpers preserve changing getters, coercion and thrown identity",async()=>{
  const api=await native();
  function run(module,operation,failAt){
    const trace=[],failure={failAt};let minimumReads=0,maximumReads=0;
    const bound=name=>({[Symbol.toPrimitive](hint){trace.push(["coerce",name,hint]);if(failAt===name)throw failure;return name==="minimum"?2:5;}});
    const schema={get jsonType(){trace.push("type");return "integer";},get minimum(){trace.push(["minimum",minimumReads++]);return minimumReads%2?0:bound("minimum");},get maximum(){trace.push(["maximum",maximumReads++]);return maximumReads%2?10:bound("maximum");}};
    try{return {trace,value:operation==="describe"?module.getExpectedNumberDescription(schema):module.isValidNumberSchemaValue(operation,schema)};}
    catch(error){assert.equal(error,failure);return {trace,error:"same failure"};}
  }
  for(const operation of ["describe",0,3,8,NaN,"3"])for(const failAt of [undefined,"minimum","maximum"])assert.deepEqual(run(api,operation,failAt),run(original,operation,failAt));
  for(const failure of [undefined,null,false,17,Symbol("failure")])assert.throws(()=>api.getExpectedNumberDescription({get jsonType(){throw failure;}}),error=>error===failure);
});

test("numeric predicates preserve live Number methods, receivers and short-circuit results",async()=>{
  const api=await native(),finite=Number.isFinite,integer=Number.isInteger;
  function run(module,result,method){
    const trace=[];
    Number[method]=function(value){trace.push([method,this===Number,value]);return result;};
    try{return {trace,value:module.isValidNumberSchemaValue(1.5,{jsonType:"integer",minimum:0,maximum:2})};}
    finally{Number.isFinite=finite;Number.isInteger=integer;}
  }
  for(const method of ["isFinite","isInteger"])for(const result of [undefined,null,false,0,"",true,"accepted",{}])assert.deepEqual(run(api,result,method),run(original,result,method));
});

test("number descriptions preserve filter callbacks, returned bounds and join coercion",async()=>{
  const api=await native(),filter=Array.prototype.filter;
  function run(module,empty){
    const trace=[];
    Array.prototype.filter=function(callback){
      trace.push(["filter",[...this],callback.name,callback.length,arguments.length]);
      trace.push(["callback",callback(undefined),callback(null),callback(""),callback(0)]);
      return {
        get length(){trace.push("length");return empty?0:"0";},
        join(separator){
          trace.push(["join",this.length,separator]);
          return {[Symbol.toPrimitive](hint){trace.push(["joined",hint]);return "custom bounds";}};
        }
      };
    };
    try{return {value:module.getExpectedNumberDescription({jsonType:"integer",minimum:2,maximum:5}),trace};}
    finally{Array.prototype.filter=filter;}
  }
  for(const empty of [true,false])assert.deepEqual(run(api,empty),run(original,empty));
});

test("number helpers preserve reentrant callbacks and arbitrary predicate failures",async()=>{
  const api=await native();
  for(const module of [original,api]){
    let nested=false;
    const schema={get jsonType(){if(!nested){nested=true;assert.equal(module.isValidNumberSchemaValue(2,schema),true);}return "integer";}};
    assert.equal(module.isValidNumberSchemaValue(2,schema),true);
    for(const failure of [undefined,null,false,17,Symbol("failure")]){
      const descriptor=Object.getOwnPropertyDescriptor(Number,"isFinite");
      try{
        Object.defineProperty(Number,"isFinite",{configurable:true,get(){throw failure;}});
        assert.throws(()=>module.isValidNumberSchemaValue(2,{}),error=>error===failure);
      }finally{Object.defineProperty(Number,"isFinite",descriptor);}
    }
  }
});
