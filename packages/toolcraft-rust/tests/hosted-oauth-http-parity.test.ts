import assert from "node:assert/strict";
import {it} from "vitest";
import {loadHostedOAuthReference} from "./hosted-oauth-reference.mjs";

const reference=loadHostedOAuthReference(["writeWebResponse","readBody","toWebRequest","credentialsFor"]);
const native=()=>import("../dist/hosted-oauth-http.js");

it("Native hosted HTTP reads mixed chunks and applies exact byte limits",async()=>{
  const api=await native();
  for(const module of [api,reference]){
    async function* chunks(){yield Buffer.from("ab");yield new Uint8Array([99,100]);yield "😀";}
    assert.equal((await module.readBody(chunks(),8)).toString(),"abcd😀");
    await assert.rejects(module.readBody(chunks(),7),{message:"Request body is too large."});
    assert.equal((await module.readBody(chunks(),NaN)).length,8);
    assert.equal((await module.readBody((async function*(){})(),-1)).length,0);
  }
});

it("Native hosted HTTP closes rejected iterators and preserves original failures",async()=>{
  const api=await native();
  async function inspect(module){const trace=[];let coercions=0;const limit={valueOf(){trace.push("limit");coercions++;return 1;}};async function* chunks(){try{trace.push("first");yield "ab";trace.push("second");yield "c";}finally{trace.push("close");}}try{await module.readBody(chunks(),limit);}catch(error){return {trace,coercions,name:error.name,message:error.message};}}
  assert.deepEqual(await inspect(api),await inspect(reference));
  for(const module of [api,reference]){const failure=Symbol("iterator");await assert.rejects(module.readBody((async function*(){yield Buffer.alloc(0);throw failure;})()),error=>error===failure);}
});

it("Native hosted HTTP translates headers, URL, method and UTF-8 body",async()=>{
  const api=await native();
  async function inspect(module,url,method,body){try{const request=module.toWebRequest({url,method,headers:{"x-many":["one","two"],"x-skip":undefined,"content-type":"text/plain"}},new URL("https://issuer.example/base"),body);return {url:request.url,method:request.method,headers:[...request.headers],body:await request.text()};}catch(error){return [error.name,error.message];}}
  for(const [url,method,body] of [["/token","POST",Buffer.from("hello 😀")],[undefined,"GET",undefined],["/empty","POST",Buffer.alloc(0)],["/bad","GET",Buffer.from("x")],["/bytes","POST",Buffer.from([255,0,128])]])assert.deepEqual(await inspect(api,url,method,body),await inspect(reference,url,method,body));
});

it("Native hosted HTTP preserves observable request and response sequencing",async()=>{
  const api=await native();
  function requestTrace(module){const trace=[];const request=new Proxy({headers:{"x-one":"one"},url:"/token",method:"POST"},{get(target,key,receiver){trace.push(String(key));return Reflect.get(target,key,receiver);}});const body={get length(){trace.push("length");return 1;},toString(encoding){trace.push(encoding);return "body";}};module.toWebRequest(request,new URL("https://issuer.example"),body);return trace;}
  assert.deepEqual(requestTrace(api),requestTrace(reference));
  function responseTrace(module){const trace=[],sentinel={};const response={setHeader(name,value){assert.equal(this,response);trace.push(["header",name,value]);},set statusCode(value){trace.push(["status",value]);},end(body){assert.equal(this,response);trace.push(["body",body.toString()]);return sentinel;}};const web={headers:new Headers({"x-test":"yes"}),status:201,arrayBuffer(){assert.equal(this,web);trace.push("arrayBuffer");return {then(callback){trace.push("then");return callback(new Uint8Array([111,107]).buffer);}};}};const result=module.writeWebResponse(response,web);return {trace,result};}
  assert.deepEqual(responseTrace(api),responseTrace(reference));
});

it("Native hosted HTTP forwards asynchronous response and credential failures",async()=>{
  const api=await native();for(const module of [api,reference]){
    const failure=Symbol("failure"),response={setHeader(){},end(){throw failure;}};
    await assert.rejects(module.writeWebResponse(response,new Response("body")),error=>error===failure);
    const storage={credentials:{async get(){throw failure;}}};await assert.rejects(module.credentialsFor(storage,"s").read(),error=>error===failure);
  }
});

it("Native hosted HTTP captures constructors before argument getters and defines an own body",async()=>{
  const api=await native();
  function inspect(module){
    const OriginalRequest=globalThis.Request,OriginalURL=globalThis.URL,trace=[];
    const descriptor=Object.getOwnPropertyDescriptor(Object.prototype,"body");
    try{
      globalThis.Request=function Request(url,options){trace.push(["request",url.href,Object.hasOwn(options,"body"),options.body]);return options;};
      globalThis.URL=function URL(value,base){trace.push("url");return new OriginalURL(value,base);};
      Object.defineProperty(Object.prototype,"body",{configurable:true,set(){trace.push("inherited setter");}});
      const request={headers:{},get url(){trace.push("path");globalThis.Request=function Request(){trace.push("wrong request");};globalThis.URL=function URL(){trace.push("wrong url");};return "/token";},method:"POST"};
      module.toWebRequest(request,new OriginalURL("https://issuer.example"),Buffer.from("body"));
      return trace;
    }finally{globalThis.Request=OriginalRequest;globalThis.URL=OriginalURL;if(descriptor)Object.defineProperty(Object.prototype,"body",descriptor);else delete Object.prototype.body;}
  }
  assert.deepEqual(inspect(api),inspect(reference));
});

it("Native hosted credential access retains live methods, receivers and opaque values",async()=>{
  const api=await native();
  for(const module of [api,reference]){
    const credential={},updated={},deleted={},update=value=>value,trace=[];
    const storage={credentials:{get(subject){assert.equal(this,storage.credentials);trace.push(["read",subject]);return credential;},update(subject,fn){assert.equal(this,storage.credentials);assert.equal(fn,update);trace.push(["update",subject]);return updated;},delete(subject){assert.equal(this,storage.credentials);trace.push(["delete",subject]);return deleted;}}};
    const access=module.credentialsFor(storage,"subject");assert.equal(await access.read.call(null),credential);assert.equal(access.update(update),updated);assert.equal(access.delete(),deleted);
    storage.credentials.get=()=>null;assert.equal(await access.read(),null);storage.credentials.get=()=>undefined;await assert.rejects(access.read(),{message:"Provider credential is missing; reconnect required."});
    assert.deepEqual(trace,[["read","subject"],["update","subject"],["delete","subject"]]);
  }
});

it("Native hosted HTTP retains truthiness of live buffer and array predicates",async()=>{
  const api=await native();
  async function inspect(module){const isBuffer=Buffer.isBuffer,from=Buffer.from,isArray=Array.isArray,trace=[],chunk=from("body");try{
    Buffer.isBuffer=value=>isBuffer(value)?{truthy:true}:false;
    Buffer.from=function(...args){if(args[0]===chunk)trace.push("copied chunk");return Reflect.apply(from,this,args);};
    Array.isArray=value=>isArray(value)?{truthy:true}:false;
    const body=await module.readBody((async function*(){yield chunk;})());
    const request=module.toWebRequest({headers:{"x-many":["one","two"]},method:"GET",url:"/"},new URL("https://issuer.example"));
    return {body:body.toString(),header:request.headers.get("x-many"),trace};
  }finally{Buffer.isBuffer=isBuffer;Buffer.from=from;Array.isArray=isArray;}}
  assert.deepEqual(await inspect(api),await inspect(reference));
});
