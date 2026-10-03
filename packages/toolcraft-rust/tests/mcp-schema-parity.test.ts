import assert from "node:assert/strict";
import {it} from "vitest";
import {reference} from "./mcp-validation-reference.mjs";
import {S,compileJsonSchema,withJsonSchema} from "../../toolcraft-schema/dist/index.js";
import {withJsonSchema as withNativeJsonSchema} from "../../toolcraft-schema-rust/dist/index.js";
const native=()=>import("../dist/mcp-schema.js");
const placements=[
  ["root",schema=>schema],
  ["object",schema=>S.Object({payload:schema})],
  ["array",schema=>S.Array(schema)],
  ["record",schema=>S.Record(schema)],
  ["oneOf",schema=>S.OneOf({discriminator:"deliveryKind",branches:{text:schema}})],
  ["union",schema=>S.Union([schema,S.Object({otherValue:S.Boolean()})])]
];
it.each(placements)("Native MCP schema projects nested defaults and requiredness at %s",async(_name,place)=>{
  const api=await native();
  for(const casing of ["snake","camel"])for(const direction of ["input","output"])for(const child of [S.String(),S.String({default:"known"}),S.Number({default:0}),S.Boolean({default:false}),S.String({nullable:true,default:null}),S.Optional(S.String()),S.Object({filePath:S.String()},{default:{filePath:"here"}}),S.Array(S.String(),{default:["one"]})]){
    const schema=place(S.Object({displayName:child}));assert.deepEqual(api.applySchemaCasing(schema,casing,direction),reference.applySchemaCasing(schema,casing,direction));
  }
});
it("Native MCP input schemas constrain optional aliases without changing result requiredness",async()=>{
  const api=await native(),schema=S.Object({displayName:S.Optional(S.String()),maxItems:S.Number({default:3})},{additionalProperties:true});
  const input=api.applySchemaCasing(schema,"snake","input"),output=api.applySchemaCasing(schema,"snake","output");
  assert.deepEqual(input,reference.applySchemaCasing(schema,"snake","input"));assert.deepEqual(output.required,["max_items"]);assert.deepEqual(input.required,[]);
  const check=compileJsonSchema(input);assert.equal(check.validate({displayName:"bad"}).ok,false);assert.equal(check.validate({display_name:"good"}).ok,true);
});
it("Native MCP schema preserves discriminator branch defaults and nullable branches",async()=>{
  const api=await native();
  for(const casing of ["snake","camel"])for(const defaultValue of [undefined,null,{displayName:"Ada"},{displayName:"Ada",deliveryKind:"wrong"}]){
    const branch=S.Object({displayName:S.String()},{nullable:true,additionalProperties:true,...(defaultValue===undefined?{}:{default:defaultValue})});
    for(const schema of [S.OneOf({discriminator:"deliveryKind",branches:{text:branch}}),{...S.Union([branch,S.Object({countValue:S.Number()})]),nullable:true,default:null}]){
      const actual=api.applySchemaCasing(schema,casing);assert.deepEqual(actual,reference.applySchemaCasing(schema,casing));
      for(const child of actual.oneOf??[])if(child.default!==undefined)assert.equal(compileJsonSchema(actual).validate(child.default).ok,true);
    }
  }
});
it("Native MCP schema keeps native documents and unmatched branches unchanged",async()=>{
  const api=await native(),document={type:"object",properties:{wire_key:{type:"string"}},required:["wire_key"]},projection=S.Object({wire_key:S.String()});
  const original=withJsonSchema(projection,document),owned=withNativeJsonSchema(projection,document),provided={type:"string",title:"provided"};
  assert.equal(api.applySchemaCasing(owned,"camel","input",provided),provided);assert.equal(reference.applySchemaCasing(original,"camel","input",provided),provided);
  const extra={type:"null"},schema=S.Union([S.Object({displayName:S.String()})]),input={oneOf:[{type:"object",properties:{displayName:{type:"string"}}},extra]};
  const actual=api.applySchemaCasing(schema,"snake","input",input);assert.deepEqual(actual,reference.applySchemaCasing(schema,"snake","input",input));assert.equal(actual.oneOf[1],extra);
});
it("Native MCP schema removes non-JSON defaults and leaves source objects untouched",async()=>{
  const api=await native();
  for(const defaultValue of [17n,()=>17,new Map([["key",17]])]){const source={kind:"json",default:defaultValue},schema={type:"object",default:"placeholder"};const actual=api.applySchemaCasing(source,"snake","output",schema);assert.deepEqual(actual,reference.applySchemaCasing(source,"snake","output",schema));assert.equal(Object.hasOwn(actual,"default"),false);assert.equal(schema.default,"placeholder");}
});
it("Native MCP schema preserves getter order, required filtering and metadata spread",async()=>{
  const api=await native();
  function traced(module){const trace=[],track=(value,label)=>new Proxy(value,{get(target,key,receiver){trace.push([label,String(key)]);return Reflect.get(target,key,receiver);}}),source=track({kind:"object",shape:{displayName:track({kind:"string",default:"Ada"},"child")},additionalProperties:true},"source"),schema=track({type:"object",properties:{displayName:{type:"string"},synthetic:{type:"string"}},required:["displayName","synthetic"],allOf:[{title:"retained"}]},"schema");return {value:module.applySchemaCasing(source,"snake","input",schema),trace};}
  assert.deepEqual(traced(api),traced(reference));
});
it("Native MCP schema preserves arbitrary getter failures and reentrant direction",async()=>{
  const api=await native();
  for(const failure of [undefined,null,false,17,Symbol("failure")])for(const module of [api,reference]){const source={kind:"object",get shape(){throw failure;}};assert.throws(()=>module.applySchemaCasing(source,"snake","input",{properties:{displayName:{type:"string"}}}),error=>error===failure);}
  function traced(module){const trace=[],nested=S.Object({maxItems:S.Number({default:3})}),source={kind:"object",get shape(){trace.push(module.applySchemaCasing(nested,"camel","output"));return {displayName:{kind:"string"}};}};return {value:module.applySchemaCasing(source,"snake","input",{properties:{displayName:{type:"string"}},required:["displayName"]}),trace};}
  assert.deepEqual(traced(api),traced(reference));
});
