import assert from "node:assert/strict";
import test from "node:test";
import {loadCLIReference} from "./cli-reference.mjs";
const original=loadCLIReference(["splitWords","formatCLIName","resolveCLIControls","validateOutputFormats","outputFormatNames","getGlobalLongOptionFlags","createGlobalSnapshotOptions"],["BUILT_IN_OUTPUT_FORMATS"]);
const native=()=>import("../dist/cli-policy.js");
function outcome(operation){try{return {value:operation()};}catch(error){return {error:{name:error?.name,message:error?.message}};}}

test("CLI naming preserves word boundaries, UTF-16, casing and runtime input behavior",async()=>{
  const api=await native();
  assert.equal(api.formatCLIName.name,original.formatCLIName.name);
  assert.equal(api.formatCLIName.length,original.formatCLIName.length);
  for(const value of ["","HTTPServerURL","snake_case words.here","a--B","ÜberΣΟΣValue","\ud800Foo\udfff","😀EmojiID",new String("boxedName"),["a","B"],false,17,{},null,undefined]){
    for(const casing of ["kebab","snake",undefined,"camel",new String("snake")])assert.deepEqual(outcome(()=>api.formatCLIName(value,casing)),outcome(()=>original.formatCLIName(value,casing)));
  }
});

test("CLI controls and global option snapshots match all toggle combinations",async()=>{
  const api=await native();
  for(let mask=0;mask<256;mask++){
    const controls={yes:!!(mask&1),output:mask&2?{formats:{compact:()=>"ok"}}:false,debug:!!(mask&4),logLevel:!!(mask&8),verbose:!!(mask&16),help:mask&32?"concise":"extended"};
    const actual=api.resolveCLIControls(controls),expected=original.resolveCLIControls(controls);
    assert.deepEqual(actual,expected);
    assert.equal(actual.outputFormats,controls.output?controls.output.formats:actual.outputFormats);
    for(const method of ["getGlobalLongOptionFlags","createGlobalSnapshotOptions"])assert.deepEqual(api[method](!!(mask&64),!!(mask&128),actual),original[method](!!(mask&64),!!(mask&128),expected));
  }
  for(const value of [undefined,null,false,1,"x",{}, {output:null},{output:true},{output:[]},{help:"other",debug:1,yes:"true"}])assert.deepEqual(outcome(()=>api.resolveCLIControls(value)),outcome(()=>original.resolveCLIControls(value)));
});

test("CLI output formats preserve validation order and exact diagnostics",async()=>{
  const api=await native();
  for(const name of [""," compact","a\tb","a\u00a0b","a\ufeffb","a\u200bb","rich","md","markdown","json","JSON","__proto__","\ud800"]){
    for(const renderer of [()=>"ok",null,{},"text"])assert.deepEqual(outcome(()=>api.resolveCLIControls({output:{formats:{[name]:renderer}}})),outcome(()=>original.resolveCLIControls({output:{formats:{[name]:renderer}}})));
  }
  function run(module){
    const trace=[];
    const formats={get rich(){trace.push("rich");return 0;},get later(){trace.push("later");return ()=>"";}};
    const controls=new Proxy({output:{formats},yes:true},{get(target,key){trace.push(key);return target[key];}});
    return {result:outcome(()=>module.resolveCLIControls(controls)),trace};
  }
  assert.deepEqual(run(api),run(original));
});

test("CLI name conversion retains live string methods, indexed getters and arbitrary throws",async()=>{
  const api=await native();
  function run(module){
    const trace=[];
    const value=new Proxy(Object("HTTPWord"),{get(target,key){trace.push(key);return target[key];}});
    const lower=String.prototype.toLowerCase,upper=String.prototype.toUpperCase;
    String.prototype.toLowerCase=function(){trace.push(["lower",String(this)]);return lower.call(this);};
    String.prototype.toUpperCase=function(){trace.push(["upper",String(this)]);return upper.call(this);};
    try{return {value:module.formatCLIName(value,"snake"),trace};}
    finally{String.prototype.toLowerCase=lower;String.prototype.toUpperCase=upper;}
  }
  assert.deepEqual(run(api),run(original));
  for(const module of [original,api])for(const failure of [undefined,null,false,17,Symbol("failure")]){
    assert.throws(()=>module.formatCLIName({get length(){throw failure;}},"kebab"),error=>error===failure);
    assert.throws(()=>module.resolveCLIControls({get output(){throw failure;}}),error=>error===failure);
  }
});

test("CLI policies preserve malformed collection method diagnostics",async()=>{
  const api=await native(),push=Array.prototype.push;
  function run(module,operation){
    Array.prototype.push=undefined;
    try{
      return outcome(()=>{
        if(operation==="name")return module.formatCLIName("helloWorld","kebab");
        const controls=module.resolveCLIControls({yes:true});
        return operation==="flags"?module.getGlobalLongOptionFlags(true,false,controls):module.createGlobalSnapshotOptions(true,false,controls);
      });
    }finally{Array.prototype.push=push;}
  }
  for(const operation of ["name","flags","options"])assert.deepEqual(run(api,operation),run(original,operation));
});

test("CLI controls preserve repeated accessor reads, option order and reentrancy",async()=>{
  const api=await native();
  function run(module){
    const trace=[];let reads=0,nested=false;
    const formats={compact:()=>"ok"};
    const controls=new Proxy({get output(){return ++reads===1?{}:reads===2?{formats}:reads===3?false:{};},yes:true,debug:true,help:"concise",logLevel:true,verbose:true},{get(target,key){trace.push(key);if(key==="help"&&!nested){nested=true;assert.equal(module.formatCLIName("NestedName","snake"),"nested_name");}return target[key];}});
    const resolved=module.resolveCLIControls(controls);
    assert.equal(resolved.outputFormats,formats);
    const traced=new Proxy(resolved,{get(target,key){trace.push(["resolved",key]);return target[key];}});
    return {trace,controls:{...resolved,outputFormats:Object.keys(resolved.outputFormats)},flags:[...module.getGlobalLongOptionFlags(true,true,traced)],options:module.createGlobalSnapshotOptions(true,true,traced)};
  }
  assert.deepEqual(run(api),run(original));
});

test("CLI format validation retains collection callbacks and closes failing iterators",async()=>{
  const api=await native(),some=Array.prototype.some,entries=Object.entries;
  function run(module,fail){
    const trace=[];
    Object.entries=function(formats){
      trace.push(["entries",this===Object,Object.keys(formats)]);
      return {[Symbol.iterator](){let index=0;return {next(){trace.push(["next",index]);return index++===0?{value:[fail?"rich":"custom",()=>"ok"],done:false}:{done:true};},return(){trace.push("closed");return {done:true};}};}};
    };
    Array.prototype.some=function(callback){trace.push(["some",callback.name,callback.length,arguments.length]);return some.call(this,callback);};
    try{
      const result=outcome(()=>module.resolveCLIControls({output:{formats:{custom:()=>"ok"}}}));
      if(result.value)result.value.outputFormats=Object.keys(result.value.outputFormats);
      return {trace,result};
    }finally{Array.prototype.some=some;Object.entries=entries;}
  }
  for(const fail of [false,true])assert.deepEqual(run(api,fail),run(original,fail));
});
