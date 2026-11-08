import assert from "node:assert/strict";
import {it} from "vitest";
import {reference} from "./hosted-oauth-reference.mjs";
const native=()=>import("../dist/hosted-oauth-config.js");
const config=()=>({publicUrl:"https://example.test/mcp",provider:{name:"Example",login:{fields:["email","password"]},connect:async()=>{},services:()=>({})},storage:{capabilities:{durable:true,encryptedCredentials:true,stableKeys:true,shared:false}}});
const outcome=fn=>{try{return {value:fn()};}catch(error){return {error:error instanceof Error?[error.name,error.message]:error};}};

it("Native hosted OAuth admits the same URLs and inherited discriminants",async()=>{
  const api=await native();
  for(const value of [null,undefined,0,"hosted",{},[],{kind:"hosted"},Object.create({kind:"hosted"}),{kind:"other"}])assert.equal(api.isHostedOAuthConfiguration(value),reference.isHostedOAuthConfiguration(value));
  for(const value of ["https://example.test/mcp","http://example.test/mcp","https://EXAMPLE.test:443/a%20b","https://example.test/","https://example.test/mcp/","https://example.test/mcp?q=1","https://example.test/mcp#x","https://u:p@example.test/mcp","invalid","custom://host/mcp"]){assert.deepEqual(outcome(()=>api.normalizePublicUrl(value).href),outcome(()=>reference.normalizePublicUrl(value).href));}
});
it("Native hosted OAuth validates fields, providers and interaction paths in reference order",async()=>{
  const api=await native();
  const cases=[()=>{},o=>{o.provider.name=" ";},o=>{delete o.provider.login;},o=>{delete o.provider.connect;},o=>{o.provider.login.fields=[];},...["signal","csrf","transaction",""].map(name=>o=>{o.provider.login.fields=[name];}),o=>{o.provider.login.fields=["email",{name:"email"}];},...[[],["relative"],["/token"],["/mcp"],["/custom","/custom"],["/custom"]].map(paths=>o=>{o.advanced={interaction:{paths}};delete o.provider.connect;delete o.provider.login;})];
  for(const change of cases){const options=config();change(options);const inspect=factory=>outcome(()=>{const result=factory(options);assert.equal(result.provider,options.provider);assert.equal(result.storage,options.storage);return {keys:Object.keys(result),kind:result.kind};});assert.deepEqual(inspect(api.hostedOAuth),inspect(reference.hostedOAuth));}
});
it("Native hosted OAuth prepares current configuration and reports ordered production errors",async()=>{
  const api=await native();
  for(const scopes of [undefined,[],["mcp"],["mcp","offline_access"],["mcp","bad scope"],["mcp"," x"],["mcp",""],["mcp","tab\tname"]])for(const production of [false,true]){
    async function inspect(factory){const options=config();options.publicUrl="http://example.test/mcp";options.storage.capabilities={durable:false,encryptedCredentials:false,stableKeys:false,shared:false};options.advanced={scopes};const value=factory(options);try{const result=await value.prepare({production});return {publicUrl:result.publicUrl.href,issuer:result.issuer.href,scopes:result.scopes};}catch(error){return [error.name,error.message];}}
    assert.deepEqual(await inspect(api.hostedOAuth),await inspect(reference.hostedOAuth));
  }
  for(const factory of [api.hostedOAuth,reference.hostedOAuth]){const value=factory(config());value.publicUrl="https://other.test/api";value.advanced={scopes:["mcp","custom"]};const prepared=await value.assertProductionReady();assert.equal(prepared.publicUrl.href,value.publicUrl);assert.equal(prepared.scopes,value.advanced.scopes);const fail=Symbol("prepare");value.prepare=async options=>{assert.deepEqual(options,{production:true});throw fail;};await assert.rejects(()=>value.assertProductionReady(),error=>error===fail);}
});
it("Native login fields preserve object identity and Unicode string formatting",async()=>{
  const api=await native();
  for(const field of ["email","password","apiKey","firstName","ßeta","😀name","",{name:"custom",label:"Custom"},null,undefined]){const actual=api.loginField(field);assert.deepEqual(actual,reference.loginField(field));if(typeof field!=="string")assert.equal(actual,field);}
});
it("Native hosted OAuth preserves live array methods, accessor order and thrown identity",async()=>{
  const api=await native();
  function inspect(factory){const trace=[];const track=(object,label)=>new Proxy(object,{get(target,key,receiver){trace.push([label,String(key)]);return Reflect.get(target,key,receiver);}});const options=config();options.provider=track({...options.provider,login:track({fields:track(["email",{name:"password"}],"fields")},"login")},"provider");options.advanced=track({interaction:track({paths:track(["/callback"],"paths")},"interaction")},"advanced");const value=factory(track(options,"options"));return {trace,kind:value.kind};}
  assert.deepEqual(inspect(api.hostedOAuth),inspect(reference.hostedOAuth));
  for(const factory of [api.hostedOAuth,reference.hostedOAuth]){const failure=Symbol("getter");const options=config();Object.defineProperty(options.provider,"name",{get(){throw failure;}});assert.throws(()=>factory(options),error=>error===failure);}
});
it("Native hosted OAuth permits reentrant configuration and custom prepare receivers",async()=>{
  const api=await native();
  for(const module of [api,reference]){const options=config();let calls=0;Object.defineProperty(options.provider,"name",{get(){calls++;assert.equal(module.hostedOAuth(config()).kind,"hosted");return "Outer";}});const value=module.hostedOAuth(options);assert.equal(calls,1);const other={...config(),advanced:{scopes:["mcp"]}};const prepared=await value.prepare.call(other,{production:true});assert.equal(prepared.scopes,other.advanced.scopes);assert.equal(prepared.publicUrl.href,other.publicUrl);}
});
it("Native hosted OAuth retains custom array callbacks and truthy path methods",async()=>{
  const api=await native();
  function inspect(factory){const options=config(),trace=[];const path={startsWith(value){trace.push(["startsWith",value,this===path]);return "yes";}};const paths=[path];paths.some=function(callback){trace.push("some");return Array.prototype.some.call(this,callback);};options.advanced={interaction:{paths}};const fields=options.provider.login.fields;fields.map=function(callback){trace.push("map");return Array.prototype.map.call(this,callback);};return {result:outcome(()=>factory(options).kind),trace};}
  assert.deepEqual(inspect(api.hostedOAuth),inspect(reference.hostedOAuth));
});
it("Native hosted OAuth derives production defaults at prepare time and preserves async failures",async()=>{
  const api=await native(),previous=process.env.NODE_ENV;
  try{for(const factory of [api.hostedOAuth,reference.hostedOAuth]){process.env.NODE_ENV="development";const options=config();options.storage.capabilities.durable=false;const value=factory(options);await value.prepare();process.env.NODE_ENV="production";await assert.rejects(()=>value.prepare(),/durable storage/);await value.prepare({production:false});const failure=Symbol("scope");Object.defineProperty(value,"advanced",{get(){throw failure;}});let pending;assert.doesNotThrow(()=>{pending=value.prepare({production:false});});await assert.rejects(()=>pending,error=>error===failure);}}
  finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
