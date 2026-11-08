import assert from "node:assert/strict";
import {it} from "vitest";
import {reference} from "./mcp-validation-reference.mjs";
import {withJsonSchema} from "../../toolcraft-schema/dist/index.js";
import {withJsonSchema as nativeJsonSchema} from "../../toolcraft-schema-rust/dist/index.js";
const native=()=>import("../dist/mcp-validation.js");
function inspect(module,schema,value,casing="snake"){
  const errors=[];
  try{return {value:module.validateSchemaValue(schema,value,casing,"input",errors),errors};}
  catch(error){return {error:{name:error?.name,message:error?.message},errors};}
}
it("Native MCP validates scalar bounds, Unicode, patterns, enums and nullable values",async()=>{
  const api=await native();
  const fixtures=[
    [{kind:"string",minLength:2,maxLength:3,pattern:"^[A-Z]+$"},["A","ABC","ABCD","😀",undefined,17]],
    [{kind:"number",integer:true,minimum:1,maximum:5},[0,2,8,1.5,NaN,Infinity,"2"]],
    [{kind:"boolean"},[true,false,0,"true",null]],
    [{kind:"enum",values:["hello","world",17]},["hello","hell",17,null,undefined]],
    [{kind:"string",nullable:true},[null,undefined,"value"]]
  ];
  for(const [schema,values] of fixtures)for(const value of values)assert.deepEqual(inspect(api,schema,value),inspect(reference,schema,value));
});
it("Native MCP preserves sparse arrays and overridden array mapping",async()=>{
  const api=await native(),schema={kind:"array",item:{kind:"number"},minItems:2,maxItems:3};
  for(const value of [[],[1],[1,2,3,4],Object.assign(new Array(3),{0:1,2:"bad"}),null])assert.deepEqual(inspect(api,schema,value),inspect(reference,schema,value));
  function traced(module){const trace=[],value=[1,2];value.map=function(callback){trace.push(this===value);return [callback(7,9)];};const result=inspect(module,schema,value);return {trace,result};}
  assert.deepEqual(traced(api),traced(reference));
});
it("Native MCP maps nested input keys, validates defaults and rejects declared aliases",async()=>{
  const api=await native(),schema={kind:"object",additionalProperties:true,shape:{displayName:{kind:"optional",inner:{kind:"string"}},retryCount:{kind:"number",default:3},options:{kind:"optional",inner:{kind:"object",default:{maxItems:5},shape:{maxItems:{kind:"number"}}}}}};
  for(const casing of ["snake","camel"])for(const value of [{},{display_name:"hello"},{displayName:"hello"},{display_name:undefined,displayName:"alias"},{retry_count:"bad"},{extra:17}])assert.deepEqual(inspect(api,schema,value,casing),inspect(reference,schema,value,casing));
  for(const module of [api,reference]){const first=inspect(module,schema,{}),second=inspect(module,schema,{});assert.notEqual(first.value.options,second.value.options);}
});
it("Native MCP preserves property descriptors and prototype-sensitive keys",async()=>{
  const api=await native(),shape=Object.create(null),value=Object.create(null);shape.__proto__={kind:"string"};shape.constructor={kind:"number"};value.proto="data";value.constructor=17;value.extra=23;
  const schema={kind:"object",shape,additionalProperties:true};
  for(const casing of ["snake","camel"]){const actual=inspect(api,schema,value,casing),expected=inspect(reference,schema,value,casing);assert.deepEqual(actual,expected);assert.deepEqual(Object.getOwnPropertyDescriptors(actual.value),Object.getOwnPropertyDescriptors(expected.value));}
});
it("Native MCP preserves schema getter order and arbitrary accessor failures",async()=>{
  const api=await native();
  function traced(module){const trace=[],track=(value,label)=>new Proxy(value,{get(target,key,receiver){trace.push([label,String(key)]);return Reflect.get(target,key,receiver);}}),schema=track({kind:"object",shape:{displayName:track({kind:"string",minLength:2},"child")}},"schema"),value=track({display_name:"x"},"value");return {result:inspect(module,schema,value),trace};}
  assert.deepEqual(traced(api),traced(reference));
  for(const failure of [undefined,null,false,17,Symbol("failure")])for(const module of [api,reference]){const value={};Object.defineProperty(value,"field",{enumerable:true,get(){throw failure;}});assert.throws(()=>module.validateObjectSchema({kind:"object",shape:{field:{kind:"string"}}},value,"snake","",[]),error=>error===failure);}
});
it("Native MCP retains native JSON-schema validation values without SDK normalization",async()=>{
  const api=await native(),document={type:"object",properties:{snake_key:{type:"string"}},required:["snake_key"],additionalProperties:false},projection={kind:"object",shape:{snake_key:{kind:"string"}}},schema=withJsonSchema(projection,document),nativeSchema=nativeJsonSchema(projection,document);
  for(const value of [{snake_key:"value"},{snakeKey:"value"},{snake_key:17},{snake_key:undefined},null]){
    assert.deepEqual(inspect(api,nativeSchema,value),inspect(reference,schema,value));
    assert.equal(api.validateSchemaValue(nativeSchema,value,"camel","",[]),value);
    assert.equal(reference.validateSchemaValue(schema,value,"camel","",[]),value);
  }
});
it("Native MCP validates records, JSON and discriminated or exclusive object unions",async()=>{
  const api=await native();
  const branches=[{kind:"object",shape:{firstName:{kind:"string"}}},{kind:"object",shape:{itemCount:{kind:"number"}}}];
  for(const schema of [{kind:"record",value:{kind:"number"}},{kind:"json"},{kind:"union",branches},{kind:"oneOf",discriminator:"modeType",branches:{first:branches[0],second:branches[1]}}])for(const value of [{},{key:17},{key:undefined},{first_name:"hello"},{item_count:2},{mode_type:"first",first_name:"hello"},[1,2],null])assert.deepEqual(inspect(api,schema,value),inspect(reference,schema,value));
});
it("Native MCP tool arguments preserve missing input and bounded validation messages",async()=>{
  const api=await native();
  function outcome(module,schema,input){try{return {value:module.validateToolArguments(schema,input,"snake")};}catch(error){return {name:error.name,message:error.message};}}
  for(const count of [0,1,13]){const schema={kind:"object",shape:Object.fromEntries(Array.from({length:count},(_,index)=>["field"+index,{kind:"string"}]))};for(const input of [undefined,null,{},17])assert.deepEqual(outcome(api,schema,input),outcome(reference,schema,input));}
});
it("Native MCP declared aliases use the live Object.hasOwn operation",async()=>{
  const api=await native(),schema={kind:"object",additionalProperties:true,shape:{displayName:{kind:"optional",inner:{kind:"string"}}}},originalHasOwn=Object.hasOwn;
  function traced(module){const trace=[];Object.hasOwn=(object,key)=>{trace.push(key);return false;};try{return {result:inspect(module,schema,{displayName:"alias"}),trace};}finally{Object.hasOwn=originalHasOwn;}}
  assert.deepEqual(traced(api),traced(reference));
});
it("Native MCP reentrant getters keep each traversal casing and error collection independent",async()=>{
  const api=await native();
  function traced(module){const trace=[],nestedSchema={kind:"object",shape:{nestedValue:{kind:"number"}}},schema={kind:"object",shape:{outerValue:{kind:"string"}}};const value={get outer_value(){trace.push(inspect(module,nestedSchema,{nestedValue:7},"camel"));return "outer";}};return {result:inspect(module,schema,value),trace};}
  assert.deepEqual(traced(api),traced(reference));
});
