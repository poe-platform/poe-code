import assert from "node:assert/strict";
import test from "node:test";
import * as original from "../../toolcraft/dist/renderer.js";
import {asMCPResult} from "../../toolcraft/dist/mcp-result.js";
import {getTheme} from "toolcraft-design";
const native=()=>import("../dist/renderer.js");

function render(api,value,output,command={name:"show_items",description:"Show items"}){
  const writes=[],calls=[];
  const primitives={
    getTheme(){calls.push(["theme",this===primitives]);return getTheme();},
    renderTable(options){calls.push(["table",this===primitives]);return JSON.stringify(options);}
  };
  try{return {status:api.renderResult(command,value,output,primitives,(...args)=>writes.push(args)),writes,calls};}
  catch(error){return {error:[error?.name,error?.message],writes,calls};}
}

test("result renderer preserves ordinary values, modes, exports and output streams",async()=>{
  const api=await native();
  assert.deepEqual(Object.keys(api),Object.keys(original));
  for(const name of Object.keys(api)){assert.equal(api[name].name,original[name].name);assert.equal(api[name].length,original[name].length);}
  const shared={value:"shared"},cycle=[1];cycle.push(cycle);
  for(const value of [undefined,null,"","hello",0,-0,1.5,NaN,Infinity,false,true,1n,Symbol("value"),()=>1,
    [],["one","two"],[1,"yes",null],[true,{},[1]],[shared,shared],cycle,
    {},{display_name:"Ada",enabled:true,tags:["one","two"],nested:{count:3}},
    {"display-name":"dash",display_name:"underscore","Display name":"literal"},
    [{first:1},{second:2}],{a:undefined,b:null,c:1n},[new Date(0),false]]){
    for(const mode of ["rich","md","json","custom"])
      assert.deepEqual(render(api,value,mode),render(original,value,mode));
  }
});

test("result renderer preserves marked MCP ownership and error routing",async()=>{
  const api=await native();
  const envelopes=[
    {content:[]},
    {content:[{type:"text",text:"first"},{type:"image",data:"ignored"},{type:"text",text:"second"}]},
    {content:[],structuredContent:{result:{answer:42}}},
    {content:[],structuredContent:{result:1,extra:true}},
    {content:[],structuredContent:null},
    {content:[],isError:true},
    {content:[{type:"text",text:"upstream failure"}],isError:true}
  ];
  for(const envelope of envelopes)for(const value of [envelope,asMCPResult(envelope)])for(const mode of ["rich","md","json"])
    assert.deepEqual(render(api,value,mode),render(original,value,mode));
});

test("custom result renderers preserve getter order, receiver and original value identity",async()=>{
  const api=await native();
  function run(module,mode,payload){
    const trace=[],result=asMCPResult({content:[],structuredContent:{result:42}}),primitives={};
    const renderers={};
    for(const name of ["rich","markdown","json"])Object.defineProperty(renderers,name,{get(){
      trace.push(["renderer",name]);
      return function(value,context){trace.push(["call",name,this===renderers,value===result,context===primitives]);return payload;};
    }});
    const command={get render(){trace.push("render");return renderers;}};
    return {status:module.renderResult(command,result,mode,primitives,(...args)=>trace.push(["write",...args])),trace};
  }
  for(const mode of ["rich","md","json"])for(const payload of [undefined,"","custom",null,{answer:1n}])
    assert.deepEqual(run(api,mode,payload),run(original,mode,payload));
});

test("result tables preserve nested labels, raw columns and arbitrary write failures",async()=>{
  const api=await native();
  function table(module,name,value){
    const calls=[],primitives={getTheme(){calls.push("theme");return {};},renderTable(options){calls.push(options);return "table";}};
    return {value:module[name](value,primitives),calls};
  }
  for(const value of [{},{first_name:"Ada",enabled:true,empty:[],nested:{field:1},rows:[{x:1},{x:2}]},{"display-name":1,display_name:2}])
    assert.deepEqual(table(api,"renderObjectTable",value),table(original,"renderObjectTable",value));
  for(const value of [[],[{name:"one",count:1},{extra:"two",count:22}],[{text:"a|b",nil:null,missing:undefined}]])
    assert.deepEqual(table(api,"renderArrayTable",value),table(original,"renderArrayTable",value));
  for(const failure of [undefined,null,false,17,Symbol("failure")])
    assert.throws(()=>api.renderResult({},"text","md",{},()=>{throw failure;}),error=>error===failure);
});

test("renderer failures preserve host diagnostics for malformed custom hooks",async()=>{
  const api=await native();
  for(const mode of ["rich","md","json"]){
    const member=mode==="md"?"markdown":mode;
    for(const hook of [true,"invalid",{}]){
      const command={render:{[member]:hook}};
      assert.deepEqual(render(api,1,mode,command),render(original,1,mode,command));
    }
  }
  const content=[];content.filter=17;
  const envelope=asMCPResult({content});
  assert.deepEqual(render(api,envelope,"md"),render(original,envelope,"md"));
});

test("renderer table getters retain lookup order, receivers and repeated value reads",async()=>{
  const api=await native();
  function run(module,name){
    const trace=[];let reads=0;
    const row={get displayName(){trace.push(["field",reads]);return ++reads;},get flags(){trace.push("flags");return [true,false];}};
    const primitives={
      get renderTable(){trace.push("table:get");return function(options){trace.push(["table:call",this===primitives]);return JSON.stringify(options);};},
      get getTheme(){trace.push("theme:get");return function(){trace.push(["theme:call",this===primitives]);return {};};}
    };
    const output=module[name](name==="renderArrayTable"?[row,row]:row,primitives);
    return {trace,output};
  }
  for(const name of ["renderObjectTable","renderArrayTable"])assert.deepEqual(run(api,name),run(original,name));
});

test("MCP text extraction preserves named filter callbacks and live method order",async()=>{
  const api=await native();
  function run(module){
    const trace=[],content=[];
    content.filter=function(callback){
      trace.push(["filter",this===content,callback.name,callback.length]);
      trace.push(["admission",callback({type:"text",text:"yes"}),callback({type:"text",text:1}),callback(null)]);
      const selected={map(callback){trace.push(["map",this===selected,callback.name,callback.length,callback({text:"selected"})]);
        const mapped={join(separator){trace.push(["join",this===mapped,separator]);return "payload";}};return mapped;
      }};
      return selected;
    };
    const envelope=asMCPResult({content});
    const output=render(module,envelope,"md");return {trace,output};
  }
  assert.deepEqual(run(api),run(original));
});

test("result rendering preserves default stream receivers and reentrant custom hooks",async()=>{
  const api=await native();
  function run(module){
    const writes=[],stdout=process.stdout.write,stderr=process.stderr.write;
    process.stdout.write=function(chunk){writes.push(["stdout",this===process.stdout,chunk]);return true;};
    process.stderr.write=function(chunk){writes.push(["stderr",this===process.stderr,chunk]);return true;};
    try{
      module.renderResult({},"ordinary","md",{});
      module.renderResult({},asMCPResult({content:[],isError:true}),"md",{});
      const command={render:{markdown(){module.renderResult({},"inner","md",{});return "outer";}}};
      module.renderResult(command,17,"md",{});
      return writes;
    }finally{process.stdout.write=stdout;process.stderr.write=stderr;}
  }
  assert.deepEqual(run(api),run(original));
});
