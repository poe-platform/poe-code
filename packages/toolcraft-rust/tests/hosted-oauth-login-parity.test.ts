import assert from "node:assert/strict";
import {it,vi} from "vitest";
import {createHash,randomBytes} from "node:crypto";
import {loadHostedOAuthReference} from "./hosted-oauth-reference.mjs";
vi.mock("node:crypto",async load=>({...await load(),randomBytes:size=>Buffer.alloc(size,7)}));
const reference=loadHostedOAuthReference(["escapeHtml","renderLogin","loginContentSecurityPolicy","renderExpiredConnection","interactionCookieName"],{createHash,randomBytes});
const native=()=>import("../dist/hosted-oauth-login.js");
const transaction=()=>({id:"transaction<&\"'",redirectUri:"https://client.example:8443/callback?q=1"});

it("Native hosted login preserves complete HTML, CSP and sensitive field handling",async()=>{
  const api=await native();
  for(const provider of ["Example","A & B <\"'>&","中文 😀 \ud800",""])for(const error of [undefined,"Try <again> & reconnect"]){const fields=[{name:"email",type:"email",label:"Email & user"},{name:"password",type:"password"},{name:"apiKey",type:"password"},{name:"custom"}];const args=[provider,fields,transaction(),"csrf<&\"'",error,{email:'a"<&@example.test',password:"never-echo-password",apiKey:"never-echo-key"}];const actual=api.renderLogin(...args);assert.deepEqual(actual,reference.renderLogin(...args));assert.equal(actual.html.includes("never-echo"),false);assert.ok(actual.contentSecurityPolicy.includes("https://client.example:8443"));}
});
it("Native hosted login escapes Unicode values and preserves expired markup and cookie names",async()=>{
  const api=await native();for(const value of ["&<>'\"","plain","😀\ud800\udfff","&amp;"])assert.equal(api.escapeHtml(value),reference.escapeHtml(value));assert.equal(api.renderExpiredConnection(),reference.renderExpiredConnection());for(const id of ["id","", "中文😀",Buffer.from([0,255,1])])assert.equal(api.interactionCookieName(id),reference.interactionCookieName(id));for(const redirectUri of ["https://a.test/cb","http://localhost:123/cb","custom://callback/path","invalid"]) {const inspect=module=>{try{return module.loginContentSecurityPolicy({redirectUri},"nonce");}catch(error){return [error.name,error.message];}};assert.deepEqual(inspect(api),inspect(reference));}
});
it("Native hosted login retains getter, coercion and array method order",async()=>{
  const api=await native();
  function inspect(module){const trace=[];const track=(value,name)=>new Proxy(value,{get(target,key,receiver){trace.push([name,String(key)]);return Reflect.get(target,key,receiver);}});const fields=track([track({name:"email",label:"Email",type:"email"},"field")],"fields");const provider={replaceAll(search,replacement){trace.push(["escape",search,replacement]);return this;},toString(){trace.push("providerString");return "Provider";}};const result=module.renderLogin(provider,fields,track(transaction(),"transaction"),"csrf",undefined,track({email:"value"},"values"));return {result,trace};}
  assert.deepEqual(inspect(api),inspect(reference));
});
it("Native hosted login preserves custom mapped collections and deferred template coercion",async()=>{
  const api=await native();
  function inspect(module){const trace=[],controls={toString(){trace.push("controlsString");return "controls";}},fields={map(callback){trace.push("map");callback({name:"custom",type:{toString(){trace.push("typeString");return "text";}}});return {join(separator){trace.push(["join",separator]);return controls;}};}};const result=module.renderLogin("Provider",fields,transaction(),"csrf");return {result,trace};}
  assert.deepEqual(inspect(api),inspect(reference));
});
it("Native hosted login retains arbitrary thrown values and interpolation errors",async()=>{
  const api=await native();for(const module of [api,reference]){const failure=Symbol("name");assert.throws(()=>module.renderLogin("Provider",[{get name(){throw failure;}}],transaction(),"csrf"),error=>error===failure);assert.throws(()=>module.renderLogin("Provider",[{name:"x",type:Symbol("type")}],transaction(),"csrf"),TypeError);assert.throws(()=>module.escapeHtml(null),TypeError);}
});
it("Native hosted login permits independent reentrant rendering during value conversion",async()=>{
  const api=await native();function inspect(module){let calls=0;const type={toString(){calls++;assert.equal(module.renderExpiredConnection(),reference.renderExpiredConnection());const nested=module.renderLogin("Nested",[],transaction(),"nested");assert.ok(nested.html.includes("Connect Nested"));return "text";}};return {rendered:module.renderLogin("Outer",[{name:"outer",type}],transaction(),"outer"),calls};}assert.deepEqual(inspect(api),inspect(reference));
});
