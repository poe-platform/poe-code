import assert from "node:assert/strict";
import {it} from "vitest";
import {loadMCPMetadataReference} from "./mcp-metadata-reference.mjs";
const original=loadMCPMetadataReference();
const native=()=>import("../dist/mcp-metadata.js");
const schema=()=>({kind:"object",shape:{displayName:{kind:"string"},httpConfig:{kind:"optional",inner:{kind:"optional",inner:{kind:"object",shape:{apiURL:{kind:"string"},retryCount:{kind:"number",default:0}}}}},enabled:{kind:"boolean",default:false},empty:{kind:"object",shape:{}}}});

it("Native MCP metadata preserves snake/camel Unicode naming and tool paths",async()=>{
  const api=await native();
  for(const value of ["","HTTPServer","apiURL","snake_case","a-b.c d","ÄpfelÖl","ΟΣValue","İ_Name","emoji😀Value","\ud800Name","123URL","__ a..B_"]){
    for(const casing of ["snake","camel"])assert.equal(api.formatSegment(value,casing),original.formatSegment(value,casing));
    assert.equal(api.formatToolName(["MyApp",value,"HTTPCall"]),original.formatToolName(["MyApp",value,"HTTPCall"]));
  }
});
it("Native MCP metadata preserves live string-like access order",async()=>{
  const api=await native();
  function inspect(module){const trace=[];const value=new Proxy({0:"H",1:"i",2:"_",3:"X",length:4},{get(target,key,receiver){trace.push(String(key));return Reflect.get(target,key,receiver);}});return {value:module.formatSegment(value,"camel"),trace};}
  assert.deepEqual(inspect(api),inspect(original));
});
it("Native MCP root normalization keeps group and child identities",async()=>{
  const api=await native();
  const root={kind:"group",name:"app",children:[]},roots=[root];
  for(const module of [api,original]){assert.equal(module.normalizeRoots(root),root);assert.equal(module.normalizeRoots(roots).children,roots);}
  assert.deepEqual(api.normalizeRoots(roots),original.normalizeRoots(roots));
});
it("Native MCP summaries inherit optional/default policy without marking empty objects",async()=>{
  const api=await native();
  for(const casing of ["snake","camel"]){assert.deepEqual(api.collectParamSummaries(schema(),casing),original.collectParamSummaries(schema(),casing));assert.deepEqual(api.collectParamSummaries(schema(),casing,["root"],true),original.collectParamSummaries(schema(),casing,["root"],true));}
  assert.deepEqual(api.collectParamSummaries(schema(),"snake"),["display_name (required)","http_config.api_url","http_config.retry_count","enabled"]);
});
it("Native MCP descriptions preserve examples, missing descriptions and JSON serialization",async()=>{
  const api=await native(),examples=[{title:"Basic",params:{name:"raw value",enabled:true,count:2,missing:undefined,value:{nested:[1,null]}}}];
  for(const description of [undefined,"","Create a record."])for(const params of [schema(),{kind:"object",shape:{}}])for(const sample of [[],examples])assert.equal(api.buildToolDescription(description,params,sample,"createRecord","snake"),original.buildToolDescription(description,params,sample,"createRecord","snake"));
});
it("Native MCP allowlists match complete path prefixes and preserve includes receivers",async()=>{
  const api=await native();
  for(const allowlist of [undefined,[],["app"],["app__jobs"],["app__jobs__run"],["ap"],["app__job"],["app__jobs__run__extra"]])assert.equal(api.matchesAllowlist("app__jobs__run",allowlist),original.matchesAllowlist("app__jobs__run",allowlist));
  function inspect(module){const trace=[],allowlist={includes(candidate){trace.push([this===allowlist,candidate]);return candidate==="app__jobs";}};return {value:module.matchesAllowlist("app__jobs__run",allowlist),trace};}
  assert.deepEqual(inspect(api),inspect(original));
});
it("Native MCP metadata preserves getter ordering and inherited defaults",async()=>{
  const api=await native();
  function inspect(module){const trace=[],track=(value,label)=>new Proxy(value,{get(target,key,receiver){trace.push([label,String(key)]);return Reflect.get(target,key,receiver);}});const child=track(Object.assign(Object.create({default:17}),{kind:"number"}),"child"),value=track({kind:"object",shape:{numberValue:child}},"schema");return {value:module.buildToolDescription("Description",value,[track({title:"Example",params:{numberValue:19}},"example")],"run","camel"),trace};}
  assert.deepEqual(inspect(api),inspect(original));
});
it("Native MCP metadata preserves arbitrary thrown values and iterator cleanup",async()=>{
  const api=await native();
  for(const failure of [undefined,null,false,17,Symbol("failure"),new Error("failure")])for(const module of [api,original]){
    const params={};Object.defineProperty(params,"bad",{enumerable:true,get(){throw failure;}});
    assert.throws(()=>module.buildToolDescription("",schema(),[{title:"Bad",params}],"run","snake"),error=>error===failure);
    const iterable={*[Symbol.iterator](){try{yield "root";throw failure;}finally{closed=true;}}};let closed=false;
    assert.throws(()=>module.collectParamSummaries(schema(),"snake",iterable),error=>error===failure);assert.equal(closed,true);
  }
});
