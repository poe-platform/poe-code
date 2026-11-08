import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Volume,createFsFromVolume } from "memfs";
import * as own from "../dist/index.js";
process.env.TSX_DISABLE_CACHE="1";
const { tsImport }=await import("tsx/esm/api");
const reference=await tsImport("../../mcp-oauth/src/client/auth-store-session-store.ts",import.meta.url);
const resource="https://RESOURCE.example:443/mcp#fragment";
const canonical="https://resource.example/mcp";
const hash=createHash("sha256").update(canonical).digest("hex");
function memory(){return createFsFromVolume(new Volume()).promises;}
function options(fs){return {backend:"file",fileStore:{fs,filePath:"/home/test/session.enc",getMachineIdentity:()=>({hostname:"host",username:"user"})}};}
function session(){return {resource:canonical,authorizationServer:"https://issuer.example",client:{clientId:"client"},discovery:{resourceMetadataUrl:"https://resource.example/metadata",resourceMetadata:{extra:true},authorizationServerMetadata:{}},tokens:{accessToken:" t ",tokenType:"Bearer",expiresAt:null}};}
const outcome=async action=>{try{return {value:await action()};}catch(error){return {error:error.message,name:error.name,code:error.code};}};
test("native OAuth session persistence interoperates in both directions with the original store",async()=> {
  const fs=memory(),a=own.createAuthStoreSessionStore(options(fs)),b=reference.createAuthStoreSessionStore(options(fs));
  assert.equal(await a.load(resource),null);const value=session();await a.save(resource,value);assert.deepEqual(await b.load(canonical),value);
  assert.ok((await fs.readFile(`/home/test/session-${hash}.enc`,"utf8")).includes("ciphertext"));
  value.tokens.refreshToken=" refresh ";await b.save(canonical,value);assert.deepEqual(await a.load(resource),value);
  await a.clear(resource);assert.equal(await b.load(canonical),null);await b.clear(canonical);
});
test("stored-session shape and Date-range admission match the independent implementation",async()=> {
  const candidates=[null,{},session(),{...session(),client:{clientId:" "}},{...session(),client:{clientId:"c",clientSecret:null}},{...session(),tokens:undefined},{...session(),tokens:null},...[-8640000000000001,-8640000000000000,8640000000000000,8640000000000001,0.5,0,null,"0"].map(expiresAt=>({...session(),tokens:{...session().tokens,expiresAt}})),...[''," ",null,123].map(refreshToken=>({...session(),tokens:{...session().tokens,refreshToken}})),{...session(),discovery:{...session().discovery,resourceMetadata:[]}}];
  const fs=memory();const args=options(fs);const a=own.createAuthStoreSessionStore(args),b=reference.createAuthStoreSessionStore(args);
  for(const value of candidates){await b.save(resource,value);assert.deepEqual(await outcome(()=>a.load(resource)),await outcome(()=>b.load(resource)));}
});
test("OAuth client registration storage keeps its exact projection and URI-specific names",async()=> {
  const internal=await import("../dist/session-store.js");const fs=memory();const args=options(fs);
  const a=internal.createAuthStoreClientStore(args),b=reference.createAuthStoreClientStore(args);
  for(const issuer of ["https://issuer.example","issuer\ud800",""]) for(const value of [{clientId:""},{clientId:" c ",clientSecret:" s ",extra:true},{clientId:"c",clientSecret:null},{clientId:3},{}]) {
    await b.save(issuer,value);assert.deepEqual(await outcome(()=>a.load(issuer)),await outcome(()=>b.load(issuer)));
    await a.clear(issuer);assert.equal(await b.load(issuer),null);
  }
});
test("keychain naming, malformed JSON and infinite expiry match without touching real credentials",async()=> {
  const internal=await import("../dist/session-store.js");
  for(const kind of ["session","client"]) for(const raw of ["not json","[]","{}",JSON.stringify(session()),JSON.stringify({clientId:"c",clientSecret:3}),JSON.stringify(session()).replace('"expiresAt":null','"expiresAt":1e400')]) {
    let expected;
    for(const factory of [reference,kind==="session" ? own : internal]) {
      const calls=[];
      const options={backend:"keychain",platform:"darwin",keychainStore:{service:"custom",account:"prefix",runCommand:async(command,args)=>{calls.push([command,args]);return {stdout:raw+"\n",stderr:"",exitCode:0};}}};
      const store=kind==="session" ? factory.createAuthStoreSessionStore(options) : factory.createAuthStoreClientStore(options);
      const value={result:await outcome(()=>store.load(kind==="session" ? resource : "https://issuer.example")),calls};
      if(factory===reference)expected=value;else assert.deepEqual(value,expected);
    }
  }
});
test("resource canonicalization handles URL values, fragments and invalid indicators",()=> {
  for(const value of [resource,new URL(resource),"urn:example:resource#fragment","https://🦊.example:443/a/../b#x"]) {
    const expected=new URL(value);expected.hash="";assert.equal(own.canonicalizeResourceIndicator(value),expected.toString());
  }
  for(const value of ["relative","//host/path",""])assert.throws(()=>own.canonicalizeResourceIndicator(value),/must be an absolute URL/);
});
