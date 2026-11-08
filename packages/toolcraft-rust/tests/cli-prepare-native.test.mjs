import assert from "node:assert/strict";
import test from "node:test";
import {Command} from "commander";
import {original} from "./cli-prepare-reference.mjs";
const native=()=>import("../dist/cli-prepare.js");
const controls={verbose:true,output:true};
const field=(id,schema)=>({id,optionPath:[id],displayPath:id,optionPathDisplay:id,schema});
const fields=[field("labels",{kind:"record",value:{kind:"string"}}),field("flags",{kind:"record",value:{kind:"boolean"}}),field("tags",{kind:"record",value:{kind:"array",item:{kind:"string"}}})];
function fixture(){
  const program=new Command("app").option("--output <format>").option("-v, --verbose").option("-a, --all").option("-n, --name <value>").option("-q, --query [value]");
  const child=program.command("run").alias("r").option("--output <format>");
  return {program,child,loaders:new Map([[program,()=>fields],[child,()=>fields]])};
}
function run(module,args,selected=controls){const {program,loaders}=fixture();return module.prepareCliArguments(program,["node","app",...args],loaders,"kebab",selected);}
function outcome(operation){try{return {value:operation()};}catch(error){return {error:{name:error?.name,message:error?.message}};}}

test("CLI preparation preserves flags, clusters, option values and terminators",async()=>{
  const api=await native();
  for(const args of [[],["-v"],["-anvalue"],["-an","run"],["-az","run"],["-q","run"],["-q","-1"],["-q","-"],["--name=run","r"],["--name","--help"],["--","-v","--help"],["--unknown","value"]])assert.deepEqual(run(api,args),run(original,args));
  assert.deepEqual(run(api,["-v"],{verbose:false,output:false}),run(original,["-v"],{verbose:false,output:false}));
});

test("CLI preparation captures first help path, aliases, unknown commands and final output",async()=>{
  const api=await native();
  for(const args of [["--help"],["r","--help"],["--help","r","-h"],["unknown","--help"],["--output=json","r","--help"],["r","--help","--output","md"],["--output","json","--help","--output=rich"],["--output","--help"],["--help","--","--output=json"]])assert.deepEqual(run(api,args),run(original,args));
  assert.deepEqual(run(api,["r","--help","--output=json"]),{argv:["node","app","r","--help","--output=json"],helpArgv:["node","app","r","--output","json"]});
});

test("CLI preparation retries default commands and normalizes only scalar dynamic flags",async()=>{
  const api=await native();
  function inspect(module,args){const {program,child,loaders}=fixture();program._defaultCommandName="run";child.command("nested",{isDefault:true});return module.prepareCliArguments(program,["node","app",...args],loaders,"kebab",controls);}
  for(const args of [["--labels.name","--value"],["--no-labels.name","text"],["--flags.enabled","false"],["--tags.names","a","b"],["--labels.name=value"],["--labels","text"],["--unknown","--help"]])assert.deepEqual(run(api,args),run(original,args));
  for(const args of [["--labels.name","value"],["position","--help"],["--output=json","--help"],["--name","--help"]])assert.deepEqual(inspect(api,args),inspect(original,args));
});

test("CLI preparation preserves argv, command, control and loader access order",async()=>{
  const api=await native();
  function inspect(module){
    const trace=[],{program,child}=fixture();
    const track=(value,label)=>new Proxy(value,{get(target,key,receiver){trace.push([label,String(key)]);return Reflect.get(target,key,receiver);}});
    const wrapped=track(program,"program");
    const fieldLoaders={get(current){trace.push(["loader",this===fieldLoaders,current===wrapped?"program":current===child?"child":"other"]);return function(){trace.push(["load",this===undefined]);return fields;};}};
    const argv=track(["node","app","-an","name","r","--labels.name","value","--help","--output=md"],"argv");
    return {value:module.prepareCliArguments(wrapped,argv,fieldLoaders,"kebab",track(controls,"controls")),trace};
  }
  assert.deepEqual(inspect(api),inspect(original));
});

test("CLI preparation preserves live find callbacks and changing default-name getters",async()=>{
  const api=await native();
  function inspect(module){
    const trace=[],{program,loaders}=fixture();
    for(const [label,items] of [["options",program.options],["commands",program.commands]])items.find=function(callback){trace.push([label,callback.name,callback.length]);return Array.prototype.find.call(this,callback);};
    let reads=0;
    Object.defineProperty(program,"_defaultCommandName",{get(){trace.push(["default",++reads]);return reads===1?"ignored":"run";}});
    return {value:module.prepareCliArguments(program,["node","app","--labels.name","text","--help"],loaders,"kebab",controls),trace};
  }
  assert.deepEqual(inspect(api),inspect(original));
  for(const module of [api,original]){
    let reads=0;assert.equal(module.getDefaultCommanderCommandName({get _defaultCommandName(){return ++reads===1?"name":17;}}),17);assert.equal(reads,2);
    assert.equal(module.getDefaultCommanderCommandName({_defaultCommandName:17}),undefined);
  }
});

test("CLI preparation keeps dynamic-resolution catch boundaries and arbitrary thrown identity",async()=>{
  const api=await native();
  for(const module of [api,original])for(const failure of [undefined,null,false,17,Symbol("failure"),new Error("failure")]){
    const {program}=fixture();
    const selected=[field("labels",{get kind(){throw failure;}})];
    assert.throws(()=>module.prepareCliArguments(program,["node","app","--labels.name","text"],new Map([[program,()=>selected]]),"kebab",controls),error=>error===failure);
    assert.throws(()=>module.prepareCliArguments(program,["node","app","position"],{get(){throw failure;}},"kebab",controls),error=>error===failure);
  }
  function inspect(module){const {program}=fixture();return module.prepareCliArguments(program,["node","app","--labels.name","text"],new Map([[program,()=>[field("labels",{kind:"string"})]]]),"kebab",controls);}
  assert.deepEqual(inspect(api),inspect(original));
});

test("CLI preparation preserves live slice, Set lookup, spread iteration and reentrancy",async()=>{
  const api=await native(),has=Set.prototype.has;
  function inspect(module){
    const trace=[],{program,loaders}=fixture(),argv=["node","app","r","--help","--output=json"];
    argv.slice=function(...args){trace.push(["slice",...args]);const result=Array.prototype.slice.apply(this,args);if(args[0]===0){const iterator=result[Symbol.iterator];result[Symbol.iterator]=function(){trace.push(["iterator",...result.values()]);return iterator.call(this);};}return result;};
    Set.prototype.has=function(value){trace.push(["has",value]);return has.call(this,value);};
    try{const result=module.prepareCliArguments(program,argv,loaders,"kebab",controls);return {argv:[...result.argv],helpArgv:result.helpArgv,trace};}finally{Set.prototype.has=has;}
  }
  assert.deepEqual(inspect(api),inspect(original));
  for(const module of [api,original]){
    const {program}=fixture(),loaders={get(){assert.deepEqual(run(module,[]),{argv:["node","app"]});return ()=>fields;}};
    assert.deepEqual(module.prepareCliArguments(program,["node","app","--labels.name","text"],loaders,"kebab",controls).argv,["node","app","--labels.name=text"]);
  }
});

test("CLI preparation preserves malformed input diagnostics",async()=>{
  const api=await native();
  const cases=[
    module=>module.prepareCliArguments(null,["node","app","text"],new Map(),"kebab",controls),
    module=>module.prepareCliArguments(new Command(),null,new Map(),"kebab",controls),
    module=>module.prepareCliArguments(new Command(),["node","app",17],new Map(),"kebab",controls),
    module=>module.prepareCliArguments(new Command(),["node","app",undefined],new Map(),"kebab",controls),
    module=>module.prepareCliArguments(new Command(),["node","app","text"],null,"kebab",controls),
    module=>module.getDefaultCommanderCommandName(null)
  ];
  for(const operation of cases)assert.deepEqual(outcome(()=>operation(api)),outcome(()=>operation(original)));
});

test("CLI preparation retains path-push diagnostics with a custom normalized array",async()=>{
  const api=await native(),push=Array.prototype.push;
  function inspect(module){
    const {program,loaders}=fixture(),argv=["node","app","r"];
    argv.slice=function(...args){const result=Array.prototype.slice.apply(this,args);result.push=push;return result;};
    Array.prototype.push=null;
    try{return outcome(()=>module.prepareCliArguments(program,argv,loaders,"kebab",controls));}finally{Array.prototype.push=push;}
  }
  assert.deepEqual(inspect(api),inspect(original));
});
