import assert from "node:assert/strict";
import {it,vi} from "vitest";
import {createInMemoryHostedOAuthStorage as reference} from "../../toolcraft/dist/http-hosted-oauth.js";
import {verifyHostedOAuthStorage} from "../../toolcraft/dist/testing/hosted-oauth-storage.js";
const native=()=>import("../dist/hosted-oauth-storage.js");

it("Native hosted storage passes the original storage conformance contract",async()=>{
  const api=await native();
  await verifyHostedOAuthStorage({createStorage:()=>api.createInMemoryHostedOAuthStorage({development:true}),credentials:[{token:"first"},{token:"second"}]});
});
it("Native hosted storage requires explicit development mode and retains live credentials",async()=>{
  const api=await native();
  for(const factory of [api.createInMemoryHostedOAuthStorage,reference]){
    for(const options of [{},{development:false},{development:"true"}])assert.throws(()=>factory(options),/requires explicit development mode/);
    const storage=factory({development:true}),credential={token:"first"};assert.deepEqual(storage.capabilities,{durable:false,encryptedCredentials:false,stableKeys:false,shared:false});await storage.credentials.set("subject",credential);assert.equal(await storage.credentials.get("subject"),credential);credential.token="changed";assert.equal((await storage.credentials.get("subject")).token,"changed");await storage.credentials.delete("subject");assert.equal(await storage.credentials.get("subject"),undefined);await assert.rejects(()=>storage.credentials.update("subject",()=>credential),/reconnect required/);
  }
});
it("Native hosted storage clones interactions and preserves structuredClone failures",async()=>{
  const api=await native();
  for(const factory of [api.createInMemoryHostedOAuthStorage,reference]){const storage=factory({development:true}),transaction={id:"one",nested:{value:1}};await storage.interactions.set(transaction);transaction.nested.value=2;const first=await storage.interactions.get("one");assert.equal(first.nested.value,1);first.nested.value=3;assert.equal((await storage.interactions.get("one")).nested.value,1);await assert.rejects(()=>storage.interactions.set({id:"bad",callback(){}}),error=>error.name==="DataCloneError");assert.equal(await storage.interactions.get("bad"),undefined);await storage.interactions.delete("one");assert.equal(await storage.interactions.get("one"),undefined);}
});
it("Native hosted storage serializes same-subject updates and recovers after queued failures",async()=>{
  const api=await native();
  async function inspect(factory){const storage=factory({development:true});await storage.credentials.set("a",1);await storage.credentials.set("b",10);const trace=[];let release,started;const running=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});const failure=Symbol("update");const first=storage.credentials.update("a",async current=>{trace.push(["first",current]);started();await gate;throw failure;});await running;const second=storage.credentials.update("a",value=>{trace.push("unexpected");return value;});const results=Promise.all([first.catch(error=>error),second.catch(error=>error)]);assert.equal(await storage.credentials.update("b",value=>value+1),11);release();assert.deepEqual(await results,[failure,failure]);assert.equal(await storage.credentials.update("a",value=>value+1),2);return trace;}
  assert.deepEqual(await inspect(api.createInMemoryHostedOAuthStorage),await inspect(reference));
});
it("Native hosted storage retains stable per-instance signing keys and opaque subject namespaces",async()=>{
  const api=await native();
  for(const factory of [api.createInMemoryHostedOAuthStorage,reference]){const storage=factory({development:true});const [first,second]=await Promise.all([storage.signingKey(),storage.signingKey()]);assert.equal(first,second);assert.equal(first.algorithm,"ES256");assert.equal(first.privateKey.type,"private");assert.equal(first.publicJwk.kty,"EC");assert.equal(first.publicJwk.crv,"P-256");assert.equal(typeof first.keyId,"string");const subject=await storage.resolveSubject("provider","account");assert.equal(subject,await storage.resolveSubject("provider","account"));assert.notEqual(subject,await storage.resolveSubject("other","account"));assert.notEqual(subject,await storage.resolveSubject("provider","other"));assert.notEqual(subject,await factory({development:true}).resolveSubject("provider","account"));}
});
it("Native hosted storage uses the current structuredClone and preserves thrown values",async()=>{
  const api=await native(),original=globalThis.structuredClone;
  for(const factory of [api.createInMemoryHostedOAuthStorage,reference]){const storage=factory({development:true}),failure=Symbol("clone");const clone=vi.spyOn(globalThis,"structuredClone").mockImplementation(original);try{await storage.interactions.set({id:"one"});await storage.interactions.get("one");assert.equal(clone.mock.calls.length,2);clone.mockImplementation(()=>{throw failure;});await assert.rejects(()=>storage.interactions.get("one"),error=>error===failure);}finally{clone.mockRestore();}}
});
