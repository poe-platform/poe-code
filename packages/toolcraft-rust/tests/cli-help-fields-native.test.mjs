import assert from "node:assert/strict";
import test from "node:test";
import {original} from "./cli-help-reference.mjs";
import {collectFields} from "../dist/cli-fields.js";
const native=()=>import("../dist/cli-help-fields.js");
const object=shape=>({kind:"object",shape});
const optional=inner=>({kind:"optional",inner});
function outcome(operation){try{return {value:operation()};}catch(error){return {error:{name:error?.name,message:error?.message}};}}
function field(schema,extra={}){return {schema,displayPath:"value",optionFlag:"--value",longAliases:[],optional:false,hasDefault:false,requiredWhenActive:true,...extra};}

test("CLI help preserves scalar value hints, positional flags and compact enum signatures",async()=>{
  const api=await native();
  const schemas=[{kind:"string"},...['date','date-time','uri','email','other'].map(format=>({kind:"string",format})),{kind:"string",pattern:'^\\d{4}-\\d{2}-\\d{2}$'},{kind:"string",pattern:'^\\d{4}-\\d{2}-\\d{2}T.*$'},{kind:"number"},{kind:"boolean"},{kind:"json"},{kind:"enum",values:["red","blue"]},{kind:"enum",values:["has space","x"]},{kind:"array",item:optional({kind:"string"})},{kind:"array",item:object({})},{kind:"array",item:{kind:"array",item:{kind:"string"}}}];
  for(const schema of schemas)for(const displayPath of ["value","config.filePath","user_name","accountId","Url","outputFiles"]){
    const base=field(schema,{displayPath,optionFlag:`--${displayPath}`,shortFlag:"v",longAliases:["--alias"]});
    for(const extra of [{},{positionalIndex:0},{positionalIndex:0,variadicPosition:true,optional:true},{hasDefault:true,defaultValue:true}]){
      const value={...base,...extra};
      for(const name of ["formatHelpFieldFlags","formatCommandParameterFieldFlags"])assert.deepEqual(outcome(()=>api[name](value,new Set())),outcome(()=>original[name](value,new Set())));
    }
    assert.equal(api.formatJsonHelpSchemaType(schema),original.formatJsonHelpSchemaType(schema));
  }
});

test("CLI help descriptions retain echo suppression, enum limits and default serialization",async()=>{
  const api=await native();
  for(const description of [undefined,"","VALUE","v_a-l.u e","Detailed value","\t value\n","Value\u00a0"]){
    for(const schema of [{kind:"string"},{kind:"enum",values:["red","blue"]},{kind:"enum",values:Array.from({length:9},(_,i)=>i)},{kind:"enum",values:["x".repeat(121)]}])for(const defaultValue of [undefined,"text",[1,false,null],{value:2},1n]){
      const value=field(schema,{description,hasDefault:defaultValue!==undefined,defaultValue});
      assert.deepEqual(outcome(()=>api.formatHelpFieldDescription(value)),outcome(()=>original.formatHelpFieldDescription(value)));
    }
  }
  for(const values of [[],["a","b"],[1,null,true],["null"]])for(const nullable of [true,false,undefined]){
    const schema={kind:"enum",values,nullable};assert.deepEqual(api.formatCLIEnumChoices(schema),original.formatCLIEnumChoices(schema));
  }
});

test("CLI dynamic help preserves nested record and object-array rows and metadata",async()=>{
  const api=await native();
  const schema=object({labels:{kind:"record",value:{kind:"string"},description:"Labels"},config:{kind:"record",value:object({filePath:{kind:"string"},enabled:{kind:"boolean",default:true},metadata:{kind:"record",value:{kind:"json"}},nested:object({targetURL:{kind:"string"}}),rows:{kind:"array",item:object({itemId:{kind:"number"}})}})},jobs:optional({kind:"array",item:object({jobName:{kind:"string"},tags:{kind:"array",item:{kind:"string"}}})}),lists:{kind:"record",value:{kind:"array",item:{kind:"string"}}}});
  for(const casing of ["kebab","snake"]){const fields=collectFields(schema,casing,new Set()).dynamicFields;for(const value of fields){assert.deepEqual(api.formatDynamicHelpFields(value,casing),original.formatDynamicHelpFields(value,casing));assert.equal(api.describeDynamicFieldType(value),original.describeDynamicFieldType(value));}}
});

test("CLI help tokenization preserves whitespace, brackets, arguments and UTF-16",async()=>{
  const api=await native();
  for(const value of ["","-h, --help","[--mode a|b] +3 more","--field.<key> <value...>","name\tvalue","<unclosed","[😀\ud800]","---x -x -- --a<b>",new String("--boxed <name>"),null,undefined,17,{}])assert.deepEqual(outcome(()=>api.tokenizeHelpFlags(value)),outcome(()=>original.tokenizeHelpFlags(value)));
});

test("CLI tokenization preserves repeated indexed reads, receivers and close-offset coercion",async()=>{
  const api=await native();
  function run(module){
    const trace=[],text="--file <path> [a|b] +3";
    const flags=new Proxy(Object(text),{get(target,key){trace.push(["get",key]);if(["slice","startsWith","indexOf"].includes(key))return function(...args){trace.push([key,this===flags,args]);const result=String.prototype[key].apply(text,args);return key==="indexOf"?{[Symbol.toPrimitive](hint){trace.push(["close",hint]);return result;}}:result;};return target[key];}});
    return {value:module.tokenizeHelpFlags(flags),trace};
  }
  assert.deepEqual(run(api),run(original));
});

test("CLI help preserves field getter order, live callbacks and default serialization",async()=>{
  const api=await native(),map=Array.prototype.map,some=Array.prototype.some,every=Array.prototype.every;
  function run(module){
    const trace=[];
    for(const [name,method]of [["map",map],["some",some],["every",every]])Array.prototype[name]=function(callback){trace.push([name,callback.name,callback.length,arguments.length]);return method.call(this,callback);};
    try{
      const value=new Proxy(field({kind:"enum",values:["red","blue"]},{displayPath:"outputFile",description:"Output file",hasDefault:true,defaultValue:{toJSON(key){trace.push(["json",key]);return "red";}}}),{get(target,key){trace.push(key);return target[key];}});
      return {description:module.formatHelpFieldDescription(value),flags:module.formatCommandParameterFieldFlags(value,new Set()),trace};
    }finally{Array.prototype.map=map;Array.prototype.some=some;Array.prototype.every=every;}
  }
  assert.deepEqual(run(api),run(original));
});

test("CLI help preserves normalization iterator closing, reentrancy and arbitrary throws",async()=>{
  const api=await native();
  function run(module){
    const trace=[];
    const description={length:1,trim(){trace.push("trim");return {toLowerCase(){trace.push("lower");return {[Symbol.iterator]:function*(){try{yield "a";yield Symbol("invalid");}finally{trace.push("closed");}}};}};}};
    return {result:outcome(()=>module.formatHelpFieldDescription(field({kind:"string"},{description}))),trace};
  }
  assert.deepEqual(run(api),run(original));
  for(const module of [original,api])for(const failure of [undefined,null,false,17,Symbol("failure")]){
    assert.throws(()=>module.formatHelpFieldDescription(field({kind:"string"},{hasDefault:true,defaultValue:{toJSON(){assert.deepEqual(module.tokenizeHelpFlags("--nested"),[{text:"--nested",role:"option"}]);throw failure;}}})),error=>error===failure);
  }
});
