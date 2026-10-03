import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {createHash,randomBytes} from "node:crypto";
import {it,vi} from "vitest";
import * as authorization from "mcp-oauth-server-rust";
import {loadHostedOAuthReference} from "./hosted-oauth-reference.mjs";

vi.mock("node:crypto",async load=>({...await load(),randomBytes:size=>Buffer.alloc(size,7)}));
vi.mock("mcp-oauth-server-rust",()=>({
  createOAuthAuthorizationServer:options=>{options.store.created(options);return options.store.server;},
  createAuthorizationInteractionSecurity:({cookieName})=>({csrfToken:"csrf",setCookie:`${cookieName}=csrf; Secure`}),
  verifyAuthorizationInteractionCsrf:input=>input.submittedToken==="csrf"&&input.cookieHeader===`${input.cookieName}=csrf`
}));
const reference=loadHostedOAuthReference(["prepareHostedOAuthRuntime","HostedOAuthLoginError","loginField","escapeHtml","renderLogin","loginContentSecurityPolicy","renderExpiredConnection","interactionCookieName","writeWebResponse","readBody","toWebRequest","credentialsFor"],{...authorization,createHash,randomBytes});
const native=()=>import("../dist/hosted-oauth-runtime.js");

function request(method,url,body="",headers={}){return Object.assign(new EventEmitter(),{method,url,headers,async *[Symbol.asyncIterator](){yield Buffer.from(body);}});}
function response(){return {statusCode:200,headers:{},body:undefined,setHeader(name,value){this.headers[name]=value;},writeHead(status,headers){this.statusCode=status;Object.assign(this.headers,headers);},end(body){this.body=body===undefined?undefined:Buffer.from(body).toString();}};}
function transaction(){return {id:"transaction",redirectUri:"https://client.example/callback",expiresAt:Date.now()+60_000};}
async function setup(module,configure=()=>{}){
  const trace=[],credentials=new Map(),transactions=new Map(),credential={token:"opaque"};let options;
  const server={issuer:"https://issuer.example",async handle(request){assert.equal(this,server);trace.push(["oauth",request.method,new URL(request.url).pathname,await request.text()]);return new Response("oauth",{status:202,headers:{"x-oauth":"yes"}});},async completeAuthorization(value){assert.equal(this,server);trace.push(["complete",value]);return {redirectUrl:new URL("https://client.example/callback?code=done")};},async verifyAccessToken(token,resource){assert.equal(this,server);trace.push(["verify",token,resource]);return {resource,scopes:["mcp"],expiresAt:123,subject:"subject",clientId:"client",tokenId:"jti"};}};
  const config={async prepare(){assert.equal(this,config);trace.push("prepare");return {issuer:new URL("https://issuer.example"),publicUrl:new URL("https://issuer.example/mcp"),scopes:["mcp","offline_access"]};},provider:{name:"Example",login:{fields:["email","password"]},async connect(values){assert.equal(this,undefined);assert.equal(Object.getPrototypeOf(values),null);trace.push(["connect",values.email,values.password,values.signal.aborted]);return {accountId:"account",credential};},async services({credentials:access,identity}){assert.equal(this,config.provider);trace.push("services");return {credential:await access.read(),identity};}},storage:{authorizationServer:{server,created(value){trace.push("create");options=value;}},async cleanup(){assert.equal(this,config.storage);trace.push("cleanup");},async healthCheck(){trace.push("health");},async signingKey(){assert.equal(this,config.storage);trace.push("key");return {opaque:true};},async resolveSubject(provider,account){trace.push(["subject",provider,account]);return "subject";},credentials:{async get(subject){trace.push(["getCredential",subject]);return credentials.get(subject);},async set(subject,value){trace.push(["setCredential",subject,value===credential]);credentials.set(subject,value);}},interactions:{async set(value){trace.push(["setInteraction",value.id]);transactions.set(value.id,value);},async get(id){trace.push(["getInteraction",id]);return transactions.get(id);},async delete(id){trace.push(["deleteInteraction",id]);transactions.delete(id);}}}};
  configure(config,{trace,server,credentials,transactions,credential});
  const runtime=await module.prepareHostedOAuthRuntime(config);
  return {runtime,config,options,trace,server,credentials,transactions,credential};
}
function view(result){return {status:result.statusCode,headers:result.headers,body:result.body};}
async function webView(result){return {status:result.status,headers:[...result.headers],body:await result.text()};}

it("Native hosted runtime prepares authorization options and starts a secured login",async()=>{
  const api=await native();
  async function inspect(module){const fixture=await setup(module),tx=transaction();const started=await fixture.options.interaction.start({request:new Request("https://issuer.example/authorize"),transaction:tx});assert.equal(fixture.transactions.get(tx.id),tx);return {trace:fixture.trace,mcpPath:fixture.runtime.mcpPath,asyncHandler:Object.getPrototypeOf(fixture.runtime.requestHandler)===Object.getPrototypeOf(async()=>{}),oauth:{...fixture.runtime.oauth,verifier:undefined},options:{...fixture.options,store:undefined,interaction:undefined},started:await webView(started)};}
  assert.deepEqual(await inspect(api),await inspect(reference));
});

it("Native hosted runtime routes health, protocol and unhandled requests",async()=>{
  const api=await native();
  async function inspect(module){const f=await setup(module),results=[];for(const [method,path,body] of [["GET","/healthz",""],["GET","/unknown",""],["POST","/token","a=b"],["GET","/.well-known/jwks.json",""],["GET","/authorize",""],["HEAD","/register",""],["POST","/revoke","token=x"]]){const res=response();results.push({handled:await f.runtime.requestHandler(request(method,path,body),res),...view(res)});}f.config.storage.healthCheck=()=>{throw Symbol("unhealthy");};const res=response();await f.runtime.requestHandler(request("GET","/healthz"),res);results.push(view(res));await assert.rejects(f.runtime.requestHandler(request("POST","/token","x".repeat(65_537)),response()),{message:"Request body is too large."});return {trace:f.trace,results};}
  assert.deepEqual(await inspect(api),await inspect(reference));
});

it("Native hosted runtime handles custom interactions and completion in order",async()=>{
  const api=await native();
  async function inspect(module){const f=await setup(module,(config,{trace,credential})=>{const custom={paths:["/custom"],start({request,transaction}){assert.equal(this,custom);trace.push(["customStart",request.url,transaction.id]);return new Response("custom start");},async handle({request,complete}){assert.equal(this,custom);trace.push(["customHandle",request.method,await request.text()]);return complete({transactionId:"transaction",accountId:"account",credential});}};config.advanced={interaction:custom};});const tx=transaction();const start=await f.options.interaction.start({request:new Request("https://issuer.example/authorize"),transaction:tx});const res=response();await f.runtime.requestHandler(request("PUT","/custom","payload"),res);const head=response();await f.runtime.requestHandler(request("HEAD","/custom","ignored"),head);return {trace:f.trace,start:await webView(start),res:view(res),head:view(head)};}
  assert.deepEqual(await inspect(api),await inspect(reference));
});

it("Native hosted form connection rejects expired CSRF and completes valid credentials",async()=>{
  const api=await native();
  async function inspect(module){const f=await setup(module),results=[];const tx=transaction();f.transactions.set(tx.id,tx);const cookie=`${reference.interactionCookieName(tx.id)}=csrf`;for(const body of ["transaction=missing&csrf=csrf","transaction=transaction&csrf=wrong","transaction=transaction&csrf=csrf&email=a%40example.test&password=secret"]){const res=response();results.push({handled:await f.runtime.requestHandler(request("POST","/oauth/connect",body,{cookie}),res),...view(res)});}assert.equal(f.credentials.get("subject"),f.credential);assert.equal(f.transactions.has(tx.id),false);return {trace:f.trace,results};}
  assert.deepEqual(await inspect(api),await inspect(reference));
});

it("Native hosted form errors preserve safe messages and suppress arbitrary failures",async()=>{
  const api=await native();
  async function inspect(module){const outcomes=[];for(const failure of [new module.HostedOAuthLoginError("Wrong <password>"),Symbol("secret"),undefined,"empty"]){const f=await setup(module,config=>{config.provider.connect=failure===undefined?undefined:failure==="empty"?()=>({accountId:"  "}):()=>{throw failure;};});const tx=transaction();f.transactions.set(tx.id,tx);const res=response();await f.runtime.requestHandler(request("POST","/oauth/connect","transaction=transaction&csrf=csrf&email=a%40example.test&password=do-not-echo",{cookie:`${reference.interactionCookieName(tx.id)}=csrf`}),res);assert.equal(res.body.includes("do-not-echo"),false);outcomes.push(view(res));}return outcomes;}
  assert.deepEqual(await inspect(api),await inspect(reference));
});

it("Native hosted runtime projects token identity and reads credentials before provider services",async()=>{
  const api=await native();
  async function inspect(module){const f=await setup(module),identity={subject:"subject"};const verified=await f.runtime.oauth.verifier.verify({token:"token"});await assert.rejects(f.runtime.requestServices(identity),{message:"Provider credential is missing; reconnect required."});f.credentials.set("subject",f.credential);const services=await f.runtime.requestServices(identity);assert.equal(services.credential,f.credential);assert.equal(services.identity,identity);return {verified,trace:f.trace};}
  assert.deepEqual(await inspect(api),await inspect(reference));
});

it("Native hosted runtime preserves abort wiring and connection cleanup failures",async()=>{
  const api=await native();
  async function inspect(module){let complete,signal,entered;const connecting=new Promise(resolve=>{entered=resolve;});const f=await setup(module,config=>{config.provider.connect=values=>{signal=values.signal;return new Promise(resolve=>{complete=resolve;entered();});};});const tx=transaction();f.transactions.set(tx.id,tx);const req=request("POST","/oauth/connect","transaction=transaction&csrf=csrf",{cookie:`${reference.interactionCookieName(tx.id)}=csrf`}),res=response();const pending=f.runtime.requestHandler(req,res);await Promise.race([connecting,pending.then(()=>{throw new Error("Connection did not start");})]);req.emit("aborted");assert.equal(signal.aborted,true);f.config.storage.interactions.delete=()=>{throw Symbol("cleanup");};complete({accountId:"account",credential:f.credential});await pending;return {trace:f.trace,res:view(res)};}
  assert.deepEqual(await inspect(api),await inspect(reference));
});

it("Native hosted redirects capture response methods before header getters",async()=>{
  const api=await native();
  async function inspect(module){const f=await setup(module),tx=transaction(),res=response();f.transactions.set(tx.id,tx);f.server.completeAuthorization=async()=>({get redirectUrl(){f.trace.push("redirectUrl");return {get href(){f.trace.push("href");return "https://client.example/callback";}};}});const head=res.writeHead;Object.defineProperty(res,"writeHead",{get(){f.trace.push("writeHead");return head;}});await f.runtime.requestHandler(request("POST","/oauth/connect","transaction=transaction&csrf=csrf",{cookie:`${reference.interactionCookieName(tx.id)}=csrf`}),res);return {trace:f.trace,res:view(res)};}
  assert.deepEqual(await inspect(api),await inspect(reference));
});

it("Native hosted custom completion captures Response before redirect getters",async()=>{
  const api=await native();
  async function inspect(module){const OriginalResponse=globalThis.Response,failure=Symbol("late constructor");const f=await setup(module,config=>{config.advanced={interaction:{paths:["/custom"],handle:({complete})=>complete({transactionId:"transaction",accountId:"account",credential:{}})}};});f.server.completeAuthorization=async()=>({get redirectUrl(){globalThis.Response=function Response(){throw failure;};return new URL("https://client.example/callback");}});try{const res=response();try{await f.runtime.requestHandler(request("GET","/custom"),res);return view(res);}catch(error){assert.equal(error,failure);return "late constructor";}}finally{globalThis.Response=OriginalResponse;}}
  assert.deepEqual(await inspect(api),await inspect(reference));
});

it("Native hosted preparation retains live getters and arbitrary setup failures",async()=>{
  const api=await native();
  async function inspect(module){const f=await setup(module,(config,{trace})=>{const track=(value,label)=>new Proxy(value,{get(target,key,receiver){trace.push([label,String(key)]);return Reflect.get(target,key,receiver);}});config.provider=track(config.provider,"provider");config.storage=track(config.storage,"storage");const advanced=track({branding:track({title:"Branded"},"branding"),scopes:["mcp"],accessTokenTtlSeconds:60},"advanced");Object.defineProperty(config,"advanced",{get(){trace.push("advanced getter");return advanced;}});const prepare=config.prepare;config.prepare=async function(){return track(await prepare.call(this),"prepared");};});return f.trace;}
  assert.deepEqual(await inspect(api),await inspect(reference));
  for(const module of [api,reference])for(const stage of ["prepare","cleanup","signingKey"]){const failure=Symbol(stage);await assert.rejects(setup(module,config=>{(stage==="prepare"?config:config.storage)[stage]=()=>{throw failure;};}),error=>error===failure);}
});
