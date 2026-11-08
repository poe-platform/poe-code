import assert from "node:assert/strict";
import test from "node:test";
import {Command,Option} from "commander";
import {original} from "./cli-options-reference.mjs";
const native=()=>import("../dist/cli-options.js");
const field=(kind,overrides={})=>({id:"value",path:["value"],displayPath:"value",optionAttribute:"value",commanderOptionAttribute:"value",optionFlag:"--value",longAliases:[],schema:{kind},description:"A value",optional:false,hasDefault:false,defaultValue:undefined,requiredWhenActive:true,...overrides});
function snapshot(option){
  assert.ok(option instanceof Option);
  return {...option,parseArg:option.parseArg===undefined?undefined:{name:option.parseArg.name,length:option.parseArg.length},...(Object.hasOwn(option,"attributeName")?{attributeName:{name:option.attributeName.name,length:option.attributeName.length}}:{}),attribute:option.attributeName()};
}
function outcome(operation){try{return {value:operation()};}catch(error){return {error:{name:error?.name,message:error?.message}};}}

test("CLI option construction preserves schema flags, aliases and collision policies",async()=>{
  const api=await native();
  for(const kind of ["boolean","array","json","string","number","enum"])for(const overrides of [{},{shortFlag:"v"},{longAliases:["--alternative","--other"]},{shortFlag:"v",longAliases:["--alternative"]},{commanderOptionAttribute:"nested.value"}])for(const globals of [new Set(),new Set(["--value"])]){
    const input=field(kind,overrides);
    assert.deepEqual(outcome(()=>api.createOption(input,globals).map(snapshot)),outcome(()=>original.createOption(input,globals).map(snapshot)));
  }
});

test("CLI constructed options retain Commander parsing and alias attribute identity",async()=>{
  const api=await native();
  for(const kind of ["boolean","array","json","string"])for(const args of [["--value","true"],["--alternative","false"],["--no-value"],["--value","a","b"],["-v","one"],["--value"]]){
    function run(module){
      const command=new Command().exitOverride().configureOutput({writeOut(){},writeErr(){}});
      for(const option of module.createOption(field(kind,{shortFlag:"v",longAliases:["--alternative"],commanderOptionAttribute:"canonical"}),new Set()))command.addOption(option);
      return outcome(()=>{command.parse(args,{from:"user"});return command.opts();});
    }
    assert.deepEqual(run(api),run(original));
  }
});

test("CLI option callbacks preserve parser semantics and live field attributes",async()=>{
  const api=await native();
  for(const module of [api,original]){
    const input=field("boolean",{longAliases:["--alias"]});
    const options=module.createOption(input,new Set());
    input.commanderOptionAttribute="changed";
    assert.equal(options[0].attributeName(),"changed");
    for(const value of [true,false,"true",undefined,null,{owned:true}])assert.equal(options[0].parseArg(value),value);
    const array=module.createOption(field("array"),new Set())[0];
    assert.deepEqual(array.parseArg("one"),["one"]);
    const previous=["zero"];
    assert.deepEqual(array.parseArg("one",previous),["zero","one"]);
    assert.deepEqual(previous,["zero"]);
    assert.deepEqual(array.parseArg("one",new Set(["zero"])),["zero","one"]);
  }
});

test("CLI option construction preserves field getter and alias iteration order",async()=>{
  const api=await native();
  function run(module,kind){
    const trace=[],aliases={*[Symbol.iterator](){trace.push("iterate");yield "--alias";trace.push("iterated");},get length(){trace.push("alias length");return 1;}};
    const input=new Proxy(field(kind,{shortFlag:"v",longAliases:aliases}),{get(target,key){trace.push(["field",key]);return target[key];}});
    const globals={has(flag){trace.push(["has",this===globals,flag]);return false;}};
    const options=module.createOption(input,globals);
    return {value:options.map(snapshot),trace};
  }
  for(const kind of ["boolean","array","json","string"])assert.deepEqual(run(api,kind),run(original,kind));
});

test("CLI option grouping preserves live flatMap callbacks and arbitrary results",async()=>{
  const api=await native();
  function run(module){
    const flatMap=Array.prototype.flatMap,trace=[],sentinel={owned:true};
    Array.prototype.flatMap=function(callback){
      trace.push(["flatMap",this.slice(),callback.name,callback.length,arguments.length]);
      trace.push(["first",callback("--custom",0).map(snapshot)]);
      trace.push(["alias",callback("--alias","0").map(snapshot)]);
      return sentinel;
    };
    try{const value=module.createOption(field("boolean"),new Set());return {same:value===sentinel,trace};}finally{Array.prototype.flatMap=flatMap;}
  }
  assert.deepEqual(run(api),run(original));
});

test("CLI options preserve live Commander method receivers and return values",async()=>{
  const api=await native();
  function run(module,kind){
    const preset=Object.getOwnPropertyDescriptor(Option.prototype,"preset"),parser=Object.getOwnPropertyDescriptor(Option.prototype,"argParser");
    const trace=[],sentinel={parsed:true};
    try{
      Object.defineProperty(Option.prototype,"preset",{configurable:true,get(){trace.push(["preset-get",this.flags]);return function(value){trace.push(["preset",this.flags,value]);return null;};}});
      Object.defineProperty(Option.prototype,"argParser",{configurable:true,get(){trace.push(["parser-get",this.flags]);return function(callback){trace.push(["parser",this.flags,callback.name,callback.length,callback("value",["previous"])]);return sentinel;};}});
      const value=module.createOption(field(kind),new Set());
      return {value:value.map(item=>item===sentinel?"sentinel":snapshot(item)),trace};
    }finally{Object.defineProperty(Option.prototype,"preset",preset);Object.defineProperty(Option.prototype,"argParser",parser);}
  }
  for(const kind of ["boolean","array"])assert.deepEqual(run(api,kind),run(original,kind));
});

test("CLI option construction preserves changing schema and attribute accessors",async()=>{
  const api=await native();
  function run(module){
    const trace=[];let kindReads=0,attributeReads=0;
    const input=field("string",{
      schema:{get kind(){trace.push(["kind",++kindReads]);return ["not-boolean","not-array","json"][kindReads-1];}},
      longAliases:[]
    });
    Object.defineProperty(input,"commanderOptionAttribute",{get(){trace.push(["attribute",++attributeReads]);return attributeReads===1?"other":"final";}});
    return {value:module.createOption(input,new Set()).map(snapshot),trace};
  }
  assert.deepEqual(run(api),run(original));
  for(const module of [api,original]){
    let entered=false;
    const input=field("boolean");
    Object.defineProperty(input,"description",{get(){if(!entered){entered=true;assert.equal(module.createOption(field("string"),new Set())[0].flags,"--value <value>");}return "nested";}});
    assert.equal(module.createOption(input,new Set())[0].description,"nested");
  }
});

test("CLI option construction preserves malformed input errors and thrown identities",async()=>{
  const api=await native();
  const cases=[
    module=>module.createOption(null,new Set()),
    module=>module.createOption(field("string"),null),
    module=>module.createOption(field("string",{longAliases:null}),new Set()),
    module=>module.createOption(field("string",{schema:null}),new Set()),
    module=>module.createCommanderOption(null,"description",field("string")),
    module=>module.createCommanderOption("--value",undefined,field("string",{longAliases:null})),
    module=>module.createOption(field("array"),new Set())[0].parseArg("one",null)
  ];
  for(const operation of cases)assert.deepEqual(outcome(()=>operation(api)),outcome(()=>operation(original)));
  for(const module of [api,original])for(const failure of [undefined,null,false,17,Symbol("failure")]){
    assert.throws(()=>module.createOption(field("string"),{has(){throw failure;}}),error=>error===failure);
    const option=module.createOption(field("array"),new Set())[0];
    assert.throws(()=>option.parseArg("one",{[Symbol.iterator](){throw failure;}}),error=>error===failure);
  }
});
