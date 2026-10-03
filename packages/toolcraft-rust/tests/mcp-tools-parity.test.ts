import assert from "node:assert/strict";
import {it} from "vitest";
import {original} from "./mcp-tools-reference.mjs";
const native=()=>import("../dist/mcp-tools.js");
const command=(name,extra={})=>({kind:"command",name,scope:["cli","sdk","mcp"],params:{kind:"object",shape:{displayName:{kind:"string"}}},examples:[],handler(){},...extra});
const group=(name,children)=>({kind:"group",name,children});
function fixture(){return group("MyApp",[command("createRecord",{title:"Create",description:"Create a record.",annotations:{readOnlyHint:false},examples:[{title:"Basic",params:{display_name:"Ada"}}],result:{kind:"object",shape:{recordId:{kind:"number"}}}}),group("HTTPQueries",[command("findRecords"),command("watchRecords",{stream:{event:{kind:"object",shape:{displayName:{kind:"string"}}},bufferSize:4}})]),command("localOnly",{scope:["cli"]})]);}
function outcome(module,root,casing="snake",allowlist=undefined,omit=false){try{return {tools:module.enumerateTools(root,casing,allowlist,omit)};}catch(error){return {error:{name:error?.name,message:error?.message}};}}
it("Native MCP enumerates nested tools with projected input/output metadata",async()=>{
  const api=await native(),root=fixture();
  for(const casing of ["snake","camel"])for(const omit of [false,true]){const actual=outcome(api,root,casing,undefined,omit);assert.deepEqual(actual,outcome(original,root,casing,undefined,omit));assert.equal(actual.tools.length,3);assert.equal(actual.tools[0].command,root.children[0]);assert.notEqual(actual.tools[0].annotations,root.children[0].annotations);}
});
it("Native MCP applies full path allowlists and omits only the single root prefix",async()=>{
  const api=await native(),root=fixture();
  for(const allowlist of [[],["my_app"],["my_app__http_queries"],["my_app__create_record"],["my_app__http"],["http_queries"]])for(const omit of [false,true])assert.deepEqual(outcome(api,root,"snake",allowlist,omit),outcome(original,root,"snake",allowlist,omit));
  const multi=group("",[root,group("OtherApp",[command("run")])]);assert.deepEqual(outcome(api,multi),outcome(original,multi));
});
it("Native MCP filters parameter scopes before allowlist admission",async()=>{
  const api=await native(),root=group("app",[command("run",{params:{kind:"object",shape:{visible:{kind:"string"},hidden:{kind:"string",scope:["cli"]}}}})]);
  assert.deepEqual(outcome(api,root),outcome(original,root));
  const invalid=group("app",[command("invalid",{params:{kind:"string"}})]);assert.deepEqual(outcome(api,invalid),outcome(original,invalid));assert.deepEqual(outcome(api,invalid,"snake",[]),{tools:[]});
});
it("Native MCP rejects duplicate tool names and cased input/output/event fields",async()=>{
  const api=await native(),collision={kind:"object",shape:{displayName:{kind:"string"},display_name:{kind:"string"}}};
  const trees=[group("app",[command("createRecord"),command("create_record")]),group("app",[command("run",{params:collision})]),group("app",[command("run",{result:collision})]),group("app",[command("run",{stream:{event:collision}})])];
  for(const tree of trees){const actual=outcome(api,tree);assert.deepEqual(actual,outcome(original,tree));assert.ok(actual.error);}
});
it("Native MCP preserves command access order while constructing definitions",async()=>{
  const api=await native();
  function inspect(module){
    const trace=[],track=(value,label)=>new Proxy(value,{get(target,key,receiver){trace.push([label,String(key)]);return Reflect.get(target,key,receiver);}});
    const node=track(command("run",{description:"Run",title:"Title",annotations:track({readOnlyHint:true},"annotation"),result:{kind:"object",shape:{resultValue:{kind:"string"}}}}),"command");
    const root=track(group("App",[node]),"root"),result=outcome(module,root);
    return {result,trace};
  }
  const actual=inspect(api),expected=inspect(original);assert.deepEqual(actual.trace,expected.trace);assert.deepEqual(actual.result.tools.map(({command:_command,...tool})=>tool),expected.result.tools.map(({command:_command,...tool})=>tool));
});
it("Native MCP closes nested child iterators on arbitrary schema getter failures",async()=>{
  const api=await native();
  for(const failure of [undefined,null,false,17,Symbol("failure")]){
    function inspect(module){const trace=[],node=command("run");Object.defineProperty(node,"params",{get(){throw failure;}});const nested=group("nested",{*[Symbol.iterator](){try{yield node;}finally{trace.push("nested closed");}}}),root=group("app",{*[Symbol.iterator](){try{yield nested;}finally{trace.push("root closed");}}});assert.throws(()=>module.enumerateTools(root,"snake",undefined,false),error=>error===failure);return trace;}
    assert.deepEqual(inspect(api),inspect(original));
  }
});
