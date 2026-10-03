import assert from "node:assert/strict";
import {it} from "vitest";
import {reference} from "./mcp-validation-reference.mjs";
import {withJsonSchema} from "../../toolcraft-schema/dist/index.js";
import {withJsonSchema as withNativeJsonSchema} from "../../toolcraft-schema-rust/dist/index.js";
import {ToolError} from "tiny-stdio-mcp-server-rust";
const native=()=>import("../dist/mcp-validation.js");
function inspect(module,schema,value,casing="snake",label="result"){
  const errors=[];
  try{return {value:module.serializeResultValue(schema,value,casing,label,errors),errors};}
  catch(error){return {error:{name:error?.name,message:error?.message,code:error?.code},errors};}
}
const nested=()=>({kind:"object",shape:{displayName:{kind:"string"},options:{kind:"object",shape:{maxItems:{kind:"number",default:3},includeMeta:{kind:"optional",inner:{kind:"boolean"}}}},tags:{kind:"array",item:{kind:"string"}}}});
it("Native MCP output projects nested result keys and defaults to both wire casings",async()=>{
  const api=await native(),value={displayName:"hello",options:{},tags:["one"]};
  for(const casing of ["snake","camel"]){const actual=inspect(api,nested(),value,casing);assert.deepEqual(actual,inspect(reference,nested(),value,casing));assert.equal(actual.errors.length,0);}
  assert.deepEqual(api.validateCommandResult(nested(),value,"snake"),{display_name:"hello",options:{max_items:3},tags:["one"]});
});
it("Native MCP output reports missing fields and extras without wire alias overwrites",async()=>{
  const api=await native();
  for(const additionalProperties of [undefined,false,true]){
    const schema={kind:"object",additionalProperties,shape:{displayName:{kind:"string"},optionalValue:{kind:"optional",inner:{kind:"number"}}}};
    for(const value of [{},{display_name:"alias"},{displayName:"kept",display_name:"discard",extra:17},{displayName:"ok",optional_value:5},{displayName:17},null])assert.deepEqual(inspect(api,schema,value),inspect(reference,schema,value));
  }
  const value=Object.create(null);value.__proto__={retained:true};value.constructor=17;
  const actual=inspect(api,{kind:"object",shape:{},additionalProperties:true},value);
  assert.deepEqual(actual,inspect(reference,{kind:"object",shape:{},additionalProperties:true},value));
  assert.equal(Object.getPrototypeOf(actual.value),Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(actual.value,"__proto__").value,value.__proto__);
});
it("Native MCP output retains sparse arrays, overridden mapping and record keys",async()=>{
  const api=await native(),item={kind:"object",shape:{itemName:{kind:"string"}}};
  for(const schema of [{kind:"array",item,minItems:2,maxItems:3},{kind:"record",value:item}])for(const value of [[],Object.assign(new Array(3),{0:{itemName:"a"},2:{itemName:"b"}}),{raw_key:{itemName:"ok"}},null])assert.deepEqual(inspect(api,schema,value),inspect(reference,schema,value));
  function traced(module){const trace=[],value=[{itemName:"first"}];value.map=function(callback){trace.push(this===value);return [callback({itemName:"custom"},7)];};return {result:inspect(module,{kind:"array",item},value),trace};}
  assert.deepEqual(traced(api),traced(reference));
});
it("Native MCP output clones optional defaults and validates them recursively",async()=>{
  const api=await native();
  for(const schema of [{kind:"optional",inner:{kind:"object",shape:{maxItems:{kind:"number"}},default:{maxItems:7}}},{kind:"optional",inner:{kind:"number",default:"invalid"}},{kind:"optional",inner:{kind:"string"}},{kind:"string",nullable:true}])for(const value of [undefined,null])assert.deepEqual(inspect(api,schema,value),inspect(reference,schema,value));
  const schema={kind:"optional",inner:{kind:"object",shape:{nestedValue:{kind:"json"}},default:{nestedValue:[1,2]}}};const first=inspect(api,schema,undefined),second=inspect(api,schema,undefined);assert.notEqual(first.value.nested_value,second.value.nested_value);
});
it("Native MCP output validates discriminated and exclusive unions using source keys",async()=>{
  const api=await native(),branches=[{kind:"object",shape:{displayName:{kind:"string"}}},{kind:"object",shape:{itemCount:{kind:"number"}}}];
  for(const schema of [{kind:"union",branches},{kind:"oneOf",discriminator:"modeType",branches:{named:branches[0],counted:branches[1]}}])for(const value of [{displayName:"hello"},{itemCount:2},{modeType:"named",displayName:"hello"},{modeType:"counted",itemCount:2},{modeType:"unknown"},null])assert.deepEqual(inspect(api,schema,value),inspect(reference,schema,value));
});
it("Native MCP output preserves native schema identity and validates before optional omission",async()=>{
  const api=await native(),projection={kind:"object",shape:{wire_key:{kind:"string"}}},document={type:"object",properties:{wire_key:{type:"string"}},required:["wire_key"]};
  for(const optional of [false,true]){
    const originalSchema=withJsonSchema(projection,document),nativeSchema=withNativeJsonSchema(projection,document),a=optional?{kind:"optional",inner:nativeSchema}:nativeSchema,b=optional?{kind:"optional",inner:originalSchema}:originalSchema;
    for(const value of [{wire_key:"value"},{wire_key:17},undefined]){assert.deepEqual(inspect(api,a,value),inspect(reference,b,value));assert.equal(api.serializeResultValue(a,value,"camel","",[]),value);}
  }
});
it("Native MCP output preserves getter ordering and descriptor flags",async()=>{
  const api=await native();
  function traced(module){const trace=[],track=(value,label)=>new Proxy(value,{get(target,key,receiver){trace.push([label,String(key)]);return Reflect.get(target,key,receiver);}}),schema=track({kind:"object",additionalProperties:true,shape:{displayName:track({kind:"string"},"child"),maxItems:track({kind:"number",default:2},"default")}},"schema"),value=track({displayName:"name",extra:17},"value");const result=inspect(module,schema,value);return {result,trace,descriptors:Object.getOwnPropertyDescriptors(result.value)};}
  const actual=traced(api);assert.deepEqual(actual,traced(reference));assert.ok(actual.trace.some(([label,key])=>label==="schema"&&key==="shape"));
});
it("Native MCP output retains arbitrary accessor failures and reentrant casing",async()=>{
  const api=await native(),schema={kind:"object",shape:{displayName:{kind:"string"}}};
  for(const failure of [undefined,null,false,17,Symbol("failure")])for(const module of [api,reference]){const value={get displayName(){throw failure;}};assert.throws(()=>module.serializeResultValue(schema,value,"snake","",[]),error=>error===failure);}
  function traced(module){const trace=[],value={get displayName(){trace.push(inspect(module,schema,{displayName:"nested"},"camel"));return "outer";}};return {result:inspect(module,schema,value),trace};}
  assert.deepEqual(traced(api),traced(reference));
});
it("Native MCP result errors retain ToolError code and bounded ASCII remainder text",async()=>{
  const api=await native();
  function outcome(module,errors){try{return {value:module.throwResultValidationErrors(errors)};}catch(error){return {name:error.name,message:error.message,code:error.code,data:error.data};}}
  for(const count of [0,1,2,13]){const errors=Array.from({length:count},(_,index)=>({path:"field"+index,message:"Invalid "+index}));assert.deepEqual(outcome(api,errors),outcome(reference,errors));}
  assert.throws(()=>api.validateCommandResult(nested(),{},"snake"),error=>error instanceof ToolError&&error.code===-32603);
});
