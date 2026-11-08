import assert from "node:assert/strict";
import test from "node:test";
import {loadCLIReference} from "./cli-reference.mjs";
const original=loadCLIReference(["splitWords","formatCLIName","unwrapOptional","toOptionFlag","toOptionAttribute","toDisplayPath","toUnionKindControlPath","toUnionKindDisplayPath","createSyntheticEnumSchema","getRequiredBranchFingerprint","collectFields","toCommanderOptionAttribute","assignPositionals","validateUniqueOptionFlags","formatOptionFlags"]);
const native=()=>import("../dist/cli-fields.js");
const object=shape=>({kind:"object",shape});
const optional=inner=>({kind:"optional",inner});
function outcome(operation){try{return {value:operation()};}catch(error){return {error:{name:error?.name,message:error?.message}};}}

test("CLI field collection preserves nested, dynamic and variant schema metadata",async()=>{
  const api=await native();
  const defaultValue={identity:true};
  const schema=object({
    HTTPServer:{kind:"string",description:"server",cliDescription:"CLI server",cliAliases:["server","--host"],short:"s",global:true,default:defaultValue},
    connection:optional(object({apiKey:{kind:"string"},settings:{kind:"record",value:{kind:"string"}}})),
    rows:{kind:"array",item:optional(object({name:{kind:"string"}}))},
    values:{kind:"array",item:{kind:"number"}},
    mode:{kind:"oneOf",discriminator:"kind",description:"Mode",branches:{local:object({path:{kind:"string"}}),remote:object({url:{kind:"string"},options:optional({kind:"record",value:{kind:"string"}})})}},
    target:{kind:"union",branches:[object({name:{kind:"string"}}),object({name:{kind:"number"}}),object({id:{kind:"number"},extra:optional({kind:"boolean"})})]}
  });
  for(const casing of ["kebab","snake"])for(const inheritedOptional of [false,true]){
    const args=[schema,casing,new Set(["--http-server"]),["parent"],inheritedOptional];
    const actual=api.collectFields(...args),expected=original.collectFields(...args);
    assert.deepEqual(actual,expected);
    assert.equal(actual.fields[0].schema,schema.shape.HTTPServer);
    assert.equal(actual.fields[0].defaultValue,defaultValue);
    assert.equal(actual.fields[0].path===actual.fields[0].optionPath,false);
    assert.equal(actual.dynamicFields[0].path,actual.dynamicFields[0].optionPath);
    assert.deepEqual(Reflect.ownKeys(actual.fields[0]),Reflect.ownKeys(expected.fields[0]));
  }
  const nested=object({outer:{kind:"union",branches:[object({child:{kind:"oneOf",discriminator:"type",branches:{a:object({value:{kind:"string"}})}}}),object({other:{kind:"string"}})]}});
  assert.deepEqual(api.collectFields(nested,"kebab",new Set()),original.collectFields(nested,"kebab",new Set()));
});

test("CLI fields preserve accessor order, changing discriminators and schema identity",async()=>{
  const api=await native();
  function run(module,kind){
    const trace=[];let reads=0;
    const child=new Proxy({kind,description:"value",get discriminator(){return "type"+(reads++);},branches:kind==="oneOf"?{one:object({value:{kind:"number"}})}:[object({value:{kind:"number"}})]},{get(target,key){trace.push(key);return target[key];}});
    const result=module.collectFields(object({choice:child}),"kebab",{has(flag){trace.push(["has",flag]);return true;}});
    return {trace,result};
  }
  for(const kind of ["oneOf","union","record","string"])assert.deepEqual(run(api,kind),run(original,kind));
});

test("CLI positionals preserve mutations, duplicates, diagnostics and empty identity",async()=>{
  const api=await native();
  const schema=object({name:{kind:"string"},tags:{kind:"array",item:{kind:"string"}},other:{kind:"number"}});
  for(const module of [original,api]){const fields=module.collectFields(schema,"kebab",new Set()).fields;assert.equal(module.assignPositionals(fields,[]),fields);}
  for(const positional of [[],["name"],["name","tags"],["missing"],["tags","name"],["name","name"],["other","tags"],["tags","tags"]]){
    function run(module){const fields=module.collectFields(schema,"kebab",new Set()).fields;return {result:outcome(()=>module.assignPositionals(fields,positional)),fields};}
    assert.deepEqual(run(api),run(original));
  }
});

test("CLI flags retain reserved-name and alias conflict policies",async()=>{
  const api=await native();
  for(const schema of [object({yes:{kind:"boolean"}}),object({yes:{kind:"boolean",short:"y"}}),object({value:{kind:"string",cliAliases:["yes"]}}),object({one:{kind:"string",cliAliases:["shared"]},two:{kind:"string",cliAliases:["--shared"]}}),object({one:{kind:"string",cliAliases:["one"]}}),object({"a-b":{kind:"string"},aB:{kind:"string"}})]){
    function run(module){const globals=new Set(["--yes"]),fields=module.collectFields(schema,"kebab",globals).fields;return {validation:outcome(()=>module.validateUniqueOptionFlags(fields,globals)),flags:fields.map(field=>outcome(()=>module.formatOptionFlags(field,globals)))};}
    assert.deepEqual(run(api),run(original));
  }
});

test("CLI field collection preserves malformed inputs and arbitrary source failures",async()=>{
  const api=await native();
  for(const schema of [null,{},object({bad:null}),object({bad:{kind:"oneOf",branches:{}}}),object({bad:{kind:"union",branches:[]}}),object({bad:{kind:"array",item:null}}),object({bad:{kind:"string",cliAliases:[17]}})])assert.deepEqual(outcome(()=>api.collectFields(schema,"kebab",new Set())),outcome(()=>original.collectFields(schema,"kebab",new Set())));
  for(const module of [original,api])for(const failure of [undefined,null,false,17,Symbol("failure")])assert.throws(()=>module.collectFields(object({get bad(){throw failure;}}),"kebab",new Set()),error=>error===failure);
});

test("CLI flag formatting evaluates the set method before the field getter",async()=>{
  const api=await native();
  function run(module){
    const trace=[];
    const field={get optionFlag(){trace.push("flag");return "--value";},shortFlag:"v",longAliases:[]};
    const flags={get has(){trace.push("has");return function(flag){trace.push(["call",this===flags,flag]);return false;};}};
    return {value:module.formatOptionFlags(field,flags),trace};
  }
  assert.deepEqual(run(api),run(original));
});

test("CLI variants preserve array method lookup before control metadata reads",async()=>{
  const api=await native(),descriptor=Object.getOwnPropertyDescriptor(Array.prototype,"push"),push=descriptor.value;
  function run(module,kind){
    const trace=[];
    Object.defineProperty(Array.prototype,"push",{configurable:true,get(){
      push.call(trace,"push lookup");
      return function(...values){
        for(const value of values)if(value&&typeof value==="object"&&Object.hasOwn(value,"optionAttribute")&&!Object.getOwnPropertyDescriptor(value,"id").get){
          for(const key of ["id","displayPath"]){const text=value[key];Object.defineProperty(value,key,{configurable:true,enumerable:true,get(){push.call(trace,[key,text]);return text;}});}
        }
        return push.apply(this,values);
      };
    }});
    try{
      const branches=kind==="oneOf"?{a:object({name:{kind:"string"}})}:[object({name:{kind:"string"}})];
      const value=module.collectFields(object({choice:{kind,branches,discriminator:"type"}}),"kebab",new Set());
      return {trace,value:JSON.parse(JSON.stringify(value))};
    }finally{Object.defineProperty(Array.prototype,"push",descriptor);}
  }
  for(const kind of ["oneOf","union"])assert.deepEqual(run(api,kind),run(original,kind));
});

test("CLI variants preserve malformed path method diagnostics",async()=>{
  const api=await native(),join=Array.prototype.join;
  function run(module){Array.prototype.join=undefined;try{return outcome(()=>module.collectFields(object({choice:{kind:"oneOf",discriminator:"type",branches:{a:object({})}}}),"kebab",new Set()));}finally{Array.prototype.join=join;}}
  assert.deepEqual(run(api),run(original));
});

test("CLI collection closes source iterators and preserves reentrant calls",async()=>{
  const api=await native(),entries=Object.entries;
  function run(module,fail){
    const trace=[];let nested=false;
    const child={get kind(){trace.push("kind");if(!nested){nested=true;assert.deepEqual(module.collectFields(object({}),"kebab",new Set()),{dynamicFields:[],fields:[],variants:[]});}if(fail)throw "source failure";return "string";}};
    Object.entries=function(value){const pairs=entries(value);return {[Symbol.iterator]:function*(){try{yield* pairs;}finally{trace.push("closed");}}};};
    try{return {value:outcome(()=>module.collectFields(object({field:child}),"kebab",new Set())),trace};}
    finally{Object.entries=entries;}
  }
  for(const fail of [false,true])assert.deepEqual(run(api,fail),run(original,fail));
});

test("CLI union callbacks retain metadata and positional setters observe ordered reads",async()=>{
  const api=await native(),map=Array.prototype.map,filter=Array.prototype.filter,forEach=Array.prototype.forEach;
  function run(module){
    const trace=[];
    Array.prototype.map=function(callback){trace.push(["map",callback.name,callback.length,arguments.length]);return map.call(this,callback);};
    Array.prototype.filter=function(callback){trace.push(["filter",callback.name,callback.length,arguments.length]);return filter.call(this,callback);};
    Array.prototype.forEach=function(callback){trace.push(["forEach",callback.name,callback.length,arguments.length]);return forEach.call(this,callback);};
    try{
      const value=module.collectFields(object({value:{kind:"union",branches:[object({arg:{kind:"string"}}),object({arg:{kind:"number"}})]}}),"kebab",new Set());
      return {trace,value};
    }finally{Array.prototype.map=map;Array.prototype.filter=filter;Array.prototype.forEach=forEach;}
  }
  assert.deepEqual(run(api),run(original));
  function positional(module){
    const trace=[];let schema={kind:"string"};
    const field={displayPath:"value",get schema(){trace.push(["schema",schema.kind]);return schema;},set positionalIndex(value){trace.push(["index",value]);schema={kind:"array"};},set variadicPosition(value){trace.push(["variadic",value]);}};
    module.assignPositionals([field],["value"]);
    return trace;
  }
  assert.deepEqual(positional(api),positional(original));
});

test("CLI positional metadata retains strict module assignment semantics",async()=>{
  const api=await native();
  for(const module of [original,api]){
    const frozen=Object.freeze({displayPath:"name",schema:{kind:"string"}});
    assert.throws(()=>module.assignPositionals([frozen],["name"]),{name:"TypeError"});
  }
});
