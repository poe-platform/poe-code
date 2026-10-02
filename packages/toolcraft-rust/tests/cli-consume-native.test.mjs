import assert from "node:assert/strict";
import test from "node:test";
import {InvalidArgumentError} from "commander";
import {original} from "./cli-consume-reference.mjs";
const native=()=>import("../dist/cli-consume.js");
function outcome(operation){try{return {value:operation()};}catch(error){return {error:{name:error?.name,message:error?.message}};}}
const schemas=[{kind:"boolean"},{kind:"boolean",nullable:true},{kind:"number"},{kind:"string"},{kind:"json"},{kind:"json",nullable:true},{kind:"array",item:{kind:"number"}},{kind:"array",item:{kind:"boolean"},minItems:2},{kind:"array",item:{kind:"string"},nullable:true}];

test("CLI field input dispatch preserves scalar, JSON, nullable and array policies",async()=>{
  const api=await native();
  for(const schema of schemas)for(const value of ["","true","false","null","1,2","-3","{\"value\":1}","{bad}"])assert.deepEqual(outcome(()=>api.parseFieldInputValue(value,schema,"value")),outcome(()=>original.parseFieldInputValue(value,schema,"value")));
});

test("CLI field consumption preserves inline values, booleans and array boundaries",async()=>{
  const api=await native();
  for(const schema of schemas)for(const args of [["--value"],["--value","true"],["--value","null"],["--value","1,2","-3","--other"],["--value","value","--","tail"],["--value","--other"],["--value",""]])for(const inline of [undefined,"true","null","-2"]){
    assert.deepEqual(outcome(()=>api.consumeFieldValue(args,0,schema,"value",inline)),outcome(()=>original.consumeFieldValue(args,0,schema,"value",inline)));
  }
  for(const module of [api,original])assert.throws(()=>module.consumeFieldValue(["--value"],0,{kind:"string"},"value"),error=>error instanceof InvalidArgumentError&&error.code==="commander.invalidArgument");
});

test("CLI parsed options preserve original values and collect validation errors",async()=>{
  const api=await native();
  function run(module,schema,value){const errors=[{path:"earlier",message:"earlier error"}],field={schema,displayPath:"nested.value"};return {value:outcome(()=>module.parseOptionFieldValue(field,value,errors)),errors};}
  for(const schema of schemas)for(const value of [null,undefined,false,17,{},[],["1,2","3"],["null","other"],"bad","null","true"])assert.deepEqual(run(api,schema,value),run(original,schema,value));
  for(const module of [api,original]){
    const value={owned:true};assert.equal(module.parseOptionFieldValue({schema:{kind:"string"}},value,[]).value,value);
    assert.deepEqual(module.parseOptionFieldValue({get schema(){throw new Error("must not read");}},null,[]),{ok:true,value:null});
  }
});

test("CLI field consumers preserve getter order and arbitrary thrown identity",async()=>{
  const api=await native();
  function run(module){
    const trace=[];
    const schema=new Proxy({kind:"array",item:{kind:"number"},minItems:3},{get(target,key){trace.push(["schema",key]);return target[key];}});
    const args=new Proxy(["--value","1","2","--next"],{get(target,key){trace.push(["args",key]);return target[key];}});
    return {result:outcome(()=>module.consumeFieldValue(args,0,schema,"value")),trace};
  }
  assert.deepEqual(run(api),run(original));
  for(const module of [api,original])for(const failure of [undefined,null,false,17,Symbol("failure")]){
    assert.throws(()=>module.consumeFieldValue([],0,{get kind(){throw failure;}},"value"),error=>error===failure);
    assert.throws(()=>module.parseOptionFieldValue({get schema(){throw failure;}},"value",[]),error=>error===failure);
  }
});

test("CLI option arrays preserve iterator cleanup on null and validation failure",async()=>{
  const api=await native();
  function run(module,first){
    const trace=[],value=[first,"unused"];
    value[Symbol.iterator]=function*(){try{trace.push("start");yield first;trace.push("second");yield "unused";}finally{trace.push("closed");}};
    const field={schema:{kind:"array",item:{kind:"number"},nullable:true},displayPath:"values"},errors=[];
    return {value:outcome(()=>module.parseOptionFieldValue(field,value,errors)),errors,trace};
  }
  for(const first of ["null","invalid","1"])assert.deepEqual(run(api,first),run(original,first));
});

test("CLI error collection preserves catch boundaries and error property ordering",async()=>{
  const api=await native();
  function run(module,failure){
    const trace=[];
    const field={get schema(){trace.push("schema");throw failure;},get displayPath(){trace.push("path");return "value";}};
    const errors={get push(){trace.push("push-get");return function(error){trace.push(["push",this===errors,error]);return 17;};}};
    return {result:outcome(()=>module.parseOptionFieldValue(field,"value",errors)),trace};
  }
  for(const failure of [new InvalidArgumentError("missing"),Object.assign(new Error("invalid"),{name:"UserError"}),new Error("unexpected")])assert.deepEqual(run(api,failure),run(original,failure));
  for(const module of [api,original]){
    const failure={owned:true};
    const field={get schema(){throw new InvalidArgumentError("missing");}};
    assert.throws(()=>module.parseOptionFieldValue(field,"value",{get push(){throw failure;}}),error=>error===failure);
    const error=new Error("invalid");Object.defineProperty(error,"name",{get(){throw failure;}});
    assert.throws(()=>module.parseOptionFieldValue({get schema(){throw error;}},"value",[]),value=>value===failure);
  }
});

test("CLI consumers preserve live array admission, index coercion and reentrancy",async()=>{
  const api=await native(),isArray=Array.isArray;
  function arrays(module){
    const trace=[],value=["1","2"];
    Array.isArray=function(input){trace.push(["isArray",input===value]);return "accepted";};
    try{return {result:module.parseOptionFieldValue({schema:{kind:"array",item:{kind:"number"}},displayPath:"values"},value,[]),trace};}finally{Array.isArray=isArray;}
  }
  assert.deepEqual(arrays(api),arrays(original));
  function index(module){
    const trace=[];
    const index={[Symbol.toPrimitive](hint){trace.push(["index",hint]);return 0;}};
    return {result:module.consumeFieldValue(["--value","true"],index,{kind:"boolean"},"value"),trace};
  }
  assert.deepEqual(index(api),index(original));
  for(const module of [api,original]){
    const schema={get kind(){assert.equal(module.parseFieldInputValue("3",{kind:"number"},"nested"),3);return "string";}};
    assert.deepEqual(module.consumeFieldValue(["--value","text"],0,schema,"value"),{nextIndex:1,value:"text"});
  }
});

test("CLI field consumers retain malformed-input diagnostics",async()=>{
  const api=await native();
  const cases=[
    module=>module.parseFieldInputValue("value",null,"value"),
    module=>module.consumeFieldValue(null,0,{kind:"boolean"},"value"),
    module=>module.consumeFieldValue(null,0,{kind:"array",item:{kind:"string"}},"value"),
    module=>module.consumeFieldValue(["--value"],Symbol("index"),{kind:"string"},"value"),
    module=>module.parseOptionFieldValue(null,"value",[]),
    module=>module.parseOptionFieldValue({schema:{kind:"number"},displayPath:"value"},"bad",null)
  ];
  for(const operation of cases)assert.deepEqual(outcome(()=>operation(api)),outcome(()=>operation(original)));
});
