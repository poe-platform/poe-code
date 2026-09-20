import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHash, sign as signBytes } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { jwtVerify } from "jose";
import * as rust from "../dist/index.js";
import * as reference from "../../mcp-oauth-server/dist/index.js";
const issuer="https://auth.example",resource="https://resource.example/mcp",redirectUri="http://127.0.0.1:12345/callback";
const pair=generateKeyPairSync("ec",{namedCurve:"P-256"});
const publicJwk=pair.publicKey.export({format:"jwk"});
const verifier="v".repeat(43),challenge=createHash("sha256").update(verifier).digest("base64url");
function fixture(implementation=rust,extra={},time=Date.now()) {
  const trace=[],transactions=[];let sequence=0;
  const store=implementation.createInMemoryAuthorizationServerStore();
  const observedStore=Object.fromEntries(Object.entries(store).map(([name,method])=>[name,async(...args)=>{trace.push(name);return method(...args);} ]));
  const server=implementation.createOAuthAuthorizationServer({issuer,resources:[resource],scopesSupported:["read","offline_access"],defaultScopes:["read","offline_access"],signingKey:{algorithm:"ES256",keyId:"k",privateKey:pair.privateKey,publicJwk},store:observedStore,interaction:{start:({request,transaction})=>{transactions.push(transaction);assert.ok(request instanceof Request);return new Response("consent");}},now:()=>{trace.push("clock");return time;},randomToken:()=>{trace.push("random");return `opaque${sequence++}`;},...extra});
  return {server,store,transactions,trace};
}
const register=f=>f.server.handle(new Request(`${issuer}/register`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({redirect_uris:[redirectUri]})}));
async function authorized(f) {
  const client=await(await register(f)).json();
  const url=new URL(`${issuer}/authorize`);
  for(const [key,value] of Object.entries({response_type:"code",client_id:client.client_id,redirect_uri:redirectUri,code_challenge:challenge,code_challenge_method:"S256",resource,state:"state"})) url.searchParams.set(key,value);
  assert.equal((await f.server.handle(new Request(url))).status,200);
  const complete=await f.server.completeAuthorization({transactionId:f.transactions[0].id,subject:"subject"});
  return {client,complete,code:complete.redirectUrl.searchParams.get("code")};
}
async function exchange(f,auth) {
  return f.server.handle(new Request(`${issuer}/token`,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",client_id:auth.client.client_id,code:auth.code,redirect_uri:redirectUri,resource,code_verifier:verifier})}));
}
test("public factory and native policy execute complete OAuth code/refresh/revocation flows",async()=>{
  const revoked=[];const f=fixture(rust,{onGrantRevoked:grant=>{revoked.push(grant);}});
  const auth=await authorized(f),response=await exchange(f,auth),body=await response.json();
  assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");
  const official=await jwtVerify(body.access_token,pair.publicKey,{issuer,audience:resource,typ:"at+jwt",algorithms:["ES256"]});
  assert.equal(official.payload.sub,"subject");assert.equal(official.payload.scope,"read offline_access");
  assert.deepEqual(await f.server.verifyAccessToken(body.access_token,resource),{subject:"subject",clientId:auth.client.client_id,resource,scopes:["read","offline_access"],tokenId:official.payload.jti,expiresAt:official.payload.exp});
  const rotate=token=>f.server.handle(new Request(`${issuer}/token`,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"refresh_token",client_id:auth.client.client_id,resource,refresh_token:token})}));
  const rotated=await(await rotate(body.refresh_token)).json();assert.notEqual(rotated.refresh_token,body.refresh_token);
  assert.equal((await rotate(body.refresh_token)).status,400);assert.equal(revoked.length,1);
  assert.equal((await rotate(rotated.refresh_token)).status,400);
});
test("raw form fragments preserve grant_type exactly like URLSearchParams",async()=>{
  const own=fixture(),oracle=fixture(reference);
  const request=()=>new Request(`${issuer}/token`,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:"grant_type=authorization_code#fragment"});
  const a=await own.server.handle(request()),b=await oracle.server.handle(request());
  assert.equal(a.status,b.status);assert.deepEqual(await a.json(),await b.json());
});
test("registration validation and HTTP routing match original body and status contracts",async()=>{
  const time=Date.now();
  const cases=[
    ["GET","/missing",null,null],["HEAD","/.well-known/jwks.json",null,null],["GET","/.well-known/oauth-authorization-server",null,null],
    ["POST","/register","application/json","not-json"],["POST","/register","application/json","[]"],["POST","/register","application/json","{}"],
    ["POST","/register","Application/JSON",'{"redirect_uris":["https://example/"]}'],
    ...[null,[],[1],["relative"],["https://example/#fragment"],["HTTPS://EXAMPLE:443/","https://example/"]].map(redirect_uris=>["POST","/register","application/json; charset=utf-8",JSON.stringify({redirect_uris})]),
    ...[null,"secret","none"].map(token_endpoint_auth_method=>["POST","/register","application/json",JSON.stringify({redirect_uris:[redirectUri],token_endpoint_auth_method})]),
    ...[null,[],[1],["other"],["authorization_code","refresh_token"]].map(grant_types=>["POST","/register","application/json",JSON.stringify({redirect_uris:[redirectUri],grant_types})]),
    ...[null,[],[1],["code","code"],["other"],["code"]].map(response_types=>["POST","/register","application/json",JSON.stringify({redirect_uris:[redirectUri],response_types})])
  ];
  for(const [method,path,contentType,body] of cases) {
    const a=fixture(rust,{},time),b=fixture(reference,{},time);
    const request=()=>new Request(`${issuer}${path}`,{method,headers:contentType===null?undefined:{"content-type":contentType},body:body??undefined});
    const own=await a.server.handle(request()),oracle=await b.server.handle(request());
    assert.equal(own.status,oracle.status,body);assert.deepEqual(await own.json(),await oracle.json(),body);assert.deepEqual(a.trace,b.trace,body);
  }
});
test("authorization and code exchange preserve exact clock/random/store sequencing",async()=>{
  const time=Date.now(),a=fixture(rust,{},time),b=fixture(reference,{},time);
  const own=await authorized(a),oracle=await authorized(b);
  assert.equal(own.complete.redirectUrl.toString(),oracle.complete.redirectUrl.toString());assert.equal(own.complete.grantId,oracle.complete.grantId);
  assert.deepEqual(a.trace,b.trace);
  const ownResponse=await exchange(a,own),oracleResponse=await exchange(b,oracle);
  const ownBody=await ownResponse.json(),oracleBody=await oracleResponse.json();
  const decode=token=>JSON.parse(Buffer.from(token.split(".")[1],"base64url"));
  assert.deepEqual(decode(ownBody.access_token),decode(oracleBody.access_token));
  assert.deepEqual({...ownBody,access_token:"token"},{...oracleBody,access_token:"token"});assert.deepEqual(a.trace,b.trace);
});
test("RS256 issuance verifies with official JOSE and own server",async()=>{
  const pair=generateKeyPairSync("rsa",{modulusLength:2048});
  const f=fixture(rust,{signingKey:{algorithm:"RS256",keyId:"rsa",privateKey:pair.privateKey,publicJwk:pair.publicKey.export({format:"jwk"})}});
  const auth=await authorized(f),body=await(await exchange(f,auth)).json();
  const verified=await jwtVerify(body.access_token,pair.publicKey,{issuer,audience:resource,algorithms:["RS256"],typ:"at+jwt"});
  assert.equal(verified.payload.sub,"subject");assert.equal((await f.server.verifyAccessToken(body.access_token,resource)).subject,"subject");
});
for (const kind of ["declared", "UTF8", "stream", "abort"]) {
  test(`stalled cancellation cannot retain ${kind} request handling or reader locks`, async()=>{
    const cancellation=Promise.withResolvers(),entered=Promise.withResolvers();let cancels=0;
    const controller=new AbortController();
    const body=new ReadableStream({start(stream){if(kind==="UTF8")stream.enqueue(new Uint8Array([255]));if(kind==="stream")stream.enqueue(new Uint8Array(70000));},cancel(){cancels++;entered.resolve();return cancellation.promise;}});
    const request=new Request(`${issuer}/register`,{method:"POST",headers:{"content-type":"application/json",...(kind==="declared"?{"content-length":"100000"}:{})},body,duplex:"half",signal:controller.signal});
    const signal=request.signal,add=signal.addEventListener.bind(signal),remove=signal.removeEventListener.bind(signal),listeners=new Set();
    signal.addEventListener=(name,listener,options)=>{if(name==="abort")listeners.add(listener);return add(name,listener,options);};
    signal.removeEventListener=(name,listener,options)=>{if(name==="abort")listeners.delete(listener);return remove(name,listener,options);};
    let observed;const result=fixture().server.handle(request).then(value=>{observed=value;},error=>{observed=error;});
    const reason=new Error("request cancelled");
    try {
      if(kind==="abort"){await setImmediate();controller.abort(reason);}
      await entered.promise;await setImmediate();
      assert.notEqual(observed,undefined,"request must finish while underlying cancellation remains pending");
      if(kind==="abort")assert.equal(observed,reason);else assert.equal(observed.status,kind==="UTF8"?400:413);
      assert.equal(cancels,1);assert.equal(request.body.locked,false);assert.equal(listeners.size,0);
    } finally {cancellation.resolve();await result;}
  });
}
test("mutated allowed algorithm cannot verify an EC signature as RS256",async()=>{
  const signingKey={algorithm:"ES256",keyId:"k",privateKey:pair.privateKey,publicJwk};
  const f=fixture(rust,{signingKey}),auth=await authorized(f),body=await(await exchange(f,auth)).json();
  const record=await f.store.getAccessToken(createHash("sha256").update(body.access_token).digest("base64url"));
  const payload=body.access_token.split(".")[1];
  const data=`${Buffer.from(JSON.stringify({alg:"RS256",typ:"at+jwt"})).toString("base64url")}.${payload}`;
  const signature=signBytes("sha256",Buffer.from(data),{key:pair.privateKey,dsaEncoding:"ieee-p1363"});
  const forged=`${data}.${signature.toString("base64url")}`;
  await f.store.putAccessToken({...record,tokenHash:createHash("sha256").update(forged).digest("base64url")});
  signingKey.algorithm="RS256";
  await assert.rejects(f.server.verifyAccessToken(forged,resource),{name:"TypeError",message:"CryptoKey does not support this operation, its algorithm.name must be RSASSA-PKCS1-v1_5"});
});
test("infinite body limits are rejected before constructing a server",()=>{
  assert.throws(()=>fixture(rust,{maxRequestBodyBytes:Infinity}),{message:"maxRequestBodyBytes must be a positive integer."});
});
test("irrelevant structured record values do not prevent native authorization decisions",async()=>{
  const store=rust.createInMemoryAuthorizationServerStore();
  const client={id:"client",redirectUris:[redirectUri],createdAt:0,extra:12n};client.self=client;
  await store.putClient(client);
  const f=fixture(rust,{store});
  const url=new URL(`${issuer}/authorize`);
  for(const [key,value] of Object.entries({response_type:"code",client_id:"client",redirect_uri:redirectUri,code_challenge:challenge,code_challenge_method:"S256",resource}))url.searchParams.set(key,value);
  assert.equal((await f.server.handle(new Request(url))).status,200);
});
test("custom storage record getters unrelated to client admission are never called",async()=>{
  const client={id:"client",redirectUris:[redirectUri],createdAt:0};
  Object.defineProperty(client,"name",{enumerable:true,get(){throw new Error("unrelated getter was read");}});
  const store=rust.createInMemoryAuthorizationServerStore();store.getClient=async()=>client;
  const f=fixture(rust,{store});
  const url=new URL(`${issuer}/authorize`);
  for(const [key,value] of Object.entries({response_type:"code",client_id:"client",redirect_uri:redirectUri,code_challenge:challenge,code_challenge_method:"S256",resource}))url.searchParams.set(key,value);
  assert.equal((await f.server.handle(new Request(url))).status,200);
});
test("client admission accepts non-enumerable redirect data without reading unused identity getters",async()=>{
  const client={};Object.defineProperty(client,"redirectUris",{value:[redirectUri]});
  Object.defineProperty(client,"id",{enumerable:true,get(){throw new Error("unused identity was read");}});
  const store=rust.createInMemoryAuthorizationServerStore();store.getClient=async()=>client;
  const f=fixture(rust,{store}),url=new URL(`${issuer}/authorize`);
  for(const [key,value] of Object.entries({response_type:"code",client_id:"client",redirect_uri:redirectUri,code_challenge:challenge,code_challenge_method:"S256",resource}))url.searchParams.set(key,value);
  assert.equal((await f.server.handle(new Request(url))).status,200);
});
test("signed hostile JWT headers and claims match original JOSE admission and error metadata",async()=>{
  const time=Date.now(),seconds=Math.floor(time/1000),own=fixture(rust,{},time),oracle=fixture(reference,{},time);
  const baseline={iss:issuer,aud:resource,sub:"subject",client_id:"client",jti:"id",scope:"read",exp:seconds+3600};
  const headers=[null,[],false,3,"header",{}, {alg:12},{alg:"RS256"},{alg:"ES256"},
    ...[null,12,"JWT","AT+JWT","application/at+jwt"].map(typ=>({alg:"ES256",typ})),
    ...[null,[],[12],["future"],["b64"]].map(crit=>({alg:"ES256",typ:"at+jwt",crit})),
    ...[null,12,false,true].map(b64=>({alg:"ES256",typ:"at+jwt",crit:["b64"],b64}))];
  const payloads=[null,[],false,12,"claims",baseline];
  for(const claim of ["iss","aud","iat","nbf","exp","sub","client_id","jti","scope"]){
    const missing={...baseline};delete missing[claim];payloads.push(missing);
    for(const value of [null,false,0,"wrong",[],[12,resource],seconds-100,seconds+100])payloads.push({...baseline,[claim]:value});
  }
  const cases=[...headers.map(header=>[header,baseline]),...payloads.map(payload=>[{alg:"ES256",typ:"at+jwt"},payload])];
  const capture=async(f,token)=>{
    try{return {value:await f.server.verifyAccessToken(token,resource)};}
    catch(error){return {error:Object.fromEntries(["name","code","message","claim","reason","payload","error","status"].filter(key=>error[key]!==undefined).map(key=>[key,error[key]]))};}
  };
  for(const [header,payload] of cases){
    const h=Buffer.from(JSON.stringify(header)).toString("base64url"),p=Buffer.from(JSON.stringify(payload)).toString("base64url"),data=`${h}.${p}`;
    const token=`${data}.${signBytes("sha256",Buffer.from(data),{key:pair.privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url")}`;
    const record={tokenHash:createHash("sha256").update(token).digest("base64url"),tokenId:"id",grantId:"grant",subject:"subject",clientId:"client",resource,expiresAt:time+3600000};
    await own.store.putAccessToken(record);await oracle.store.putAccessToken(record);
    assert.deepEqual(await capture(own,token),await capture(oracle,token),JSON.stringify({header,payload}));
  }
});
