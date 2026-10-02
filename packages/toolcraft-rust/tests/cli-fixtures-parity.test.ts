import assert from "node:assert/strict";
import {afterEach,beforeEach,it,vi} from "vitest";
import {Volume,createFsFromVolume} from "memfs";
import * as nativeDefinitions from "../dist/index.js";
import * as referenceDefinitions from "../../toolcraft/dist/index.js";
import {loadFixtureReference} from "./cli-fixtures-reference.mjs";
const io=vi.hoisted(()=>({readFile:vi.fn()}));
vi.mock("node:fs/promises",async importOriginal=>({...await importOriginal(),readFile:io.readFile}));
const original=loadFixtureReference(io.readFile),volume=new Volume();
import * as api from "../dist/cli-fixtures.js";
beforeEach(()=>{volume.reset();io.readFile.mockReset().mockImplementation(createFsFromVolume(volume).promises.readFile);vi.stubEnv("TOOLCRAFT_FIXTURE","");vi.stubEnv("POE_API_KEY","fixture-test-key");vi.stubEnv("TOOLCRAFT_TEST_SECRET",undefined);});
afterEach(()=>vi.unstubAllEnvs());
function command(module:typeof nativeDefinitions){const OriginalError=globalThis.Error;globalThis.Error=class extends OriginalError{stack="Error\n at fixture (file:///virtual/run.ts:12:4)";};try{return module.defineCommand({name:"run",secrets:{test:{env:"TOOLCRAFT_TEST_SECRET"}},params:module.S.Object({}),handler:()=>null});}finally{globalThis.Error=OriginalError;}}
async function asyncOutcome(run:()=>unknown){try{return {value:await run()};}catch(error){return {error:{name:error?.name,message:error?.message,cause:error?.cause?.message}};}}

it("Native fixture matching preserves prefixes, partial objects, arrays and method policies",async()=>{
  const values=[undefined,null,false,1,NaN,-0,"user%","user-one",[1,2],{name:"user%"},{name:"user-one",other:true}];
  for(const expected of values)for(const actual of values)assert.equal(api.matchesFixtureValue(expected,actual),original.matchesFixtureValue(expected,actual));
  for(const name of ["GET","readFile","listItems","hasThing","POST","save","updateOne","writeFile","custom",""])for(const operation of ["isReadLikeMethod","isWriteLikeMethod"])assert.equal(api[operation](name),original[operation](name));
});

it("Native fixture services preserve argument matching, response identity and write defaults",async()=>{
  const definition={find:[{request:{name:"user%"},result:{id:3}},{args:[7],response:"seven"}],get:{key:"value"},fail:[{error:"failure"}]};
  async function inspect(module:typeof original){const service=module.createFixtureService(definition);return {then:service.then,found:await service.find({name:"user-one"}),args:await service.find(7),mapped:await service.get("key"),read:await service.readUnknown(),write:await service.saveUnknown(),error:await asyncOutcome(()=>service.fail())};}
  assert.deepEqual(await inspect(api),await inspect(original));
  for(const module of [api,original]){assert.equal(await module.createFixtureService(definition).find({name:"user-one"}),definition.find[0].result);assert.throws(()=>module.resolveFixtureMethodResult("fail",definition.fail,[]),{message:"failure"});}
});

it("Native fixture fetch and filesystem capabilities match their real host interfaces",async()=>{
  const entries=[{request:{url:"https://fixture.invalid/items"},response:{body:{ok:true}}},{request:{method:"post",url:"https://fixture.invalid/items"},response:{status:201,headers:{"x-test":"yes"},body:"created"}}];
  async function inspect(module:typeof original){
    const fetch=module.createFixtureFetch(entries),results=[];
    for(const [input,init] of [["https://fixture.invalid/items",undefined],[new URL("https://fixture.invalid/items"),{method:"POST"}],[new Request("https://fixture.invalid/items",{method:"POST"}),undefined],["https://fixture.invalid/missing",undefined],["https://fixture.invalid/missing",{method:"DELETE"}]]){const response=await fetch(input,init);results.push(response===null?null:{status:response.status,headers:[...response.headers],body:await response.text()});}
    const fs=module.createFixtureFs({readFile:JSON.parse('{"file":"contents","__proto__":"own"}'),exists:{file:false,missing:true}});
    return {results,read:await fs.readFile("file"),absent:await fs.readFile("other"),special:await fs.readFile("__proto__"),exists:[await fs.exists("file"),await fs.exists("missing"),await fs.exists("__proto__")],write:await fs.writeFile("file","ignored"),link:(await fs.lstat("file")).isSymbolicLink()};
  }
  assert.deepEqual(await inspect(api),await inspect(original));
});

it("Native fixture scenarios load by name or index and preserve file diagnostics",async()=>{
  const commands=[command(nativeDefinitions),command(referenceDefinitions)];
  for(const content of ['[{"name":"first","services":{}},{"name":"second"}]',"{}","{","[]"]){
    volume.fromJSON({"/virtual/run.fixture.json":content});
    for(const selector of ["1","2","0","3","first","missing",""])assert.deepEqual(await asyncOutcome(()=>api.loadFixtureScenario(commands[0],selector)),await asyncOutcome(()=>original.loadFixtureScenario(commands[1],selector)));
  }
  volume.reset();assert.deepEqual(await asyncOutcome(()=>api.loadFixtureScenario(commands[0],"1")),await asyncOutcome(()=>original.loadFixtureScenario(commands[1],"1")));
  assert.deepEqual(await asyncOutcome(()=>api.loadFixtureScenario({name:"no-source"},"1")),await asyncOutcome(()=>original.loadFixtureScenario({name:"no-source"},"1")));
});

it("Native fixture runtime preserves normal capabilities and supplies isolated fixture services",async()=>{
  const services={store:{identity:true}},fetch=async()=>{throw new Error("Unexpected network");},fs={identity:"fs"},env={TOOLCRAFT_TEST_SECRET:"provided"},requirements={version:"1"};
  for(const [module,definitions] of [[api,nativeDefinitions],[original,referenceDefinitions]]){
    const cmd=command(definitions),runtime=await module.resolveFixtureRuntime(cmd,services,requirements,fetch,env,fs);
    assert.equal(runtime.services,services);assert.equal(runtime.fetch,fetch);assert.equal(runtime.fs,fs);assert.equal(runtime.requirementOptions,requirements);assert.equal(runtime.env.get("TOOLCRAFT_TEST_SECRET"),"provided");assert.equal(runtime.secrets.test,"provided");assert.equal(runtime.isFixture,false);
    volume.fromJSON({"/virtual/run.fixture.json":'[{"name":"demo","services":{"store":{"get":{"key":42}},"extra":{"read":[{"result":"extra"}]},"params":{},"fetch":[{"request":{"url":"https://fixture.invalid/"},"response":{"body":{"ok":true}}}],"fs":{"readFile":{"file":"fixture"}}}}]'});vi.stubEnv("TOOLCRAFT_FIXTURE","demo");
    const fixture=await module.resolveFixtureRuntime(cmd,services,requirements,fetch,env,fs);
    assert.equal(fixture.isFixture,true);assert.equal(fixture.secrets.test,"fixture-secret");assert.equal(fixture.env.get("TOOLCRAFT_TEST_SECRET"),"fixture-secret");assert.equal(fixture.env.get("POE_API_KEY"),"fixture-test-key");assert.deepEqual(Object.keys(fixture.services),["store","extra"]);assert.equal(await fixture.services.store.get("key"),42);assert.equal(await fixture.services.extra.read(),"extra");assert.equal(await fixture.fs.readFile("file"),"fixture");assert.deepEqual(await (await fixture.fetch("https://fixture.invalid/")).json(),{ok:true});
    assert.equal((await module.resolveFixtureRuntime(cmd,services,requirements,fetch,env,fs,true)).isFixture,false);vi.stubEnv("TOOLCRAFT_FIXTURE","");
  }
});

it("Native fixture matching and services preserve live methods, getter order and promise lookup",async()=>{
  function inspect(module:typeof original){
    const trace:unknown[]=[],track=(value:object,name:string)=>new Proxy(value,{get(target,key,receiver){trace.push([name,String(key)]);return Reflect.get(target,key,receiver);}});
    const entry=track({request:track({name:"user%"},"request"),result:"matched"},"entry");
    const definition=[entry];definition[Symbol.iterator]=function*(){try{trace.push("iterator");yield entry;}finally{trace.push("closed");}};
    const descriptor=Object.getOwnPropertyDescriptor(Promise,"resolve");Object.defineProperty(Promise,"resolve",{configurable:true,get(){trace.push("resolve lookup");return descriptor.value;}});
    let result;try{result=module.resolveFixtureMethodResult("find",definition,[track({name:"user-one"},"argument")]);}finally{Object.defineProperty(Promise,"resolve",descriptor);}
    return {trace,result};
  }
  const actual=inspect(api),expected=inspect(original);assert.deepEqual(actual.trace,expected.trace);assert.equal(await actual.result,await expected.result);
  for(const module of [api,original]){
    const expected=[1];expected.every=function(callback){assert.equal(this,expected);assert.equal(callback.length,2);return "custom";};assert.equal(module.matchesFixtureValue(expected,[1]),"custom");
    const objectIs=vi.spyOn(Object,"is").mockReturnValueOnce("live");try{assert.equal(module.matchesFixtureValue(1,2),"live");}finally{objectIs.mockRestore();}
    const method={toLowerCase:()=>({startsWith:()=>0})};assert.equal(module.isReadLikeMethod(method),0);assert.equal(module.isWriteLikeMethod(method),0);
  }
});

it("Native fixture response construction preserves getters and rejects invalid host responses",async()=>{
  async function inspect(module:typeof original){
    const trace:unknown[]=[],response=new Proxy({status:201,headers:{"x-test":"yes"},body:{value:3}},{get(target,key,receiver){trace.push(String(key));return Reflect.get(target,key,receiver);}});
    const value=module.createFixtureResponse(response);return {trace,status:value.status,body:await value.text(),headers:[...value.headers]};
  }
  assert.deepEqual(await inspect(api),await inspect(original));
  for(const response of [null,{}, {status:204,body:"bad"},{status:999},{body:1n},{body:null},{headers:{"content-type":"custom"},body:[1,2]}])assert.deepEqual(await asyncOutcome(async()=>{const r=api.createFixtureResponse(response);return {status:r.status,body:await r.text(),headers:[...r.headers]};}),await asyncOutcome(async()=>{const r=original.createFixtureResponse(response);return {status:r.status,body:await r.text(),headers:[...r.headers]};}));
});

it("Native fixture service proxies retain live definitions, symbols and arbitrary thrown identity",async()=>{
  for(const module of [api,original]){
    const definition={read:{key:1}},service=module.createFixtureService(definition);assert.equal(await service,service);assert.equal(await service.read("key"),1);definition.read.key=2;assert.equal(await service.read("key"),2);
    assert.equal(await service[Symbol("read")](),null);assert.equal(Object.getPrototypeOf(service),Object.prototype);
    for(const failure of [undefined,null,false,17,Symbol("failure"),new Error("failure")]){
      const trace=[],entry={};Object.defineProperty(entry,"request",{get(){throw failure;}});
      const entries=[entry];entries[Symbol.iterator]=function*(){try{yield entry;}finally{trace.push("closed");}};
      assert.throws(()=>module.resolveFixtureMethodResult("find",entries,[]),error=>error===failure);assert.deepEqual(trace,["closed"]);
      const methods={};Object.defineProperty(methods,"find",{get(){throw failure;}});await assert.rejects(module.createFixtureService(methods).find(),error=>error===failure);
    }
  }
});

it("Native scenario loading preserves await timing, swallowed read errors and concurrent selections",async()=>{
  async function inspect(module:typeof original,definitions:typeof nativeDefinitions){
    const trace=[],cmd=command(definitions);io.readFile.mockImplementationOnce((path,options)=>{trace.push(["read",path,options]);return {get then(){trace.push("then");return resolve=>{trace.push("resolve");resolve('[{"name":"first"}]');};}};});
    const pending=module.loadFixtureScenario(cmd,"1");trace.push("returned");queueMicrotask(()=>trace.push("tick"));const result=await pending;trace.push("done");return {trace,result};
  }
  assert.deepEqual(await inspect(api,nativeDefinitions),await inspect(original,referenceDefinitions));
  for(const [module,definitions] of [[api,nativeDefinitions],[original,referenceDefinitions]]){
    const cmd=command(definitions),releases=[];io.readFile.mockImplementation(()=>new Promise(resolve=>releases.push(resolve)));
    const first=module.loadFixtureScenario(cmd,"first"),second=module.loadFixtureScenario(cmd,"second");
    releases[1]('[{"name":"second"}]');assert.equal((await second).name,"second");releases[0]('[{"name":"first"}]');assert.equal((await first).name,"first");
    for(const failure of [null,undefined,new Error("permission denied")]){io.readFile.mockRejectedValueOnce(failure);await assert.rejects(module.loadFixtureScenario(cmd,"1"),{message:'Fixture file not found for command "run". Expected /virtual/run.fixture.json.'});}
  }
});

it("Native fixture runtime preserves service-name construction order and environment defaults",async()=>{
  async function inspect(module:typeof original,definitions:typeof nativeDefinitions){
    const trace:unknown[]=[],cmd=command(definitions),services=new Proxy({store:{}},{ownKeys(target){trace.push("service keys");return Reflect.ownKeys(target);}});
    io.readFile.mockResolvedValueOnce('[{"name":"demo","services":{"store":{},"extra":{}}}]');vi.stubEnv("TOOLCRAFT_FIXTURE","demo");
    const descriptor=Object.getOwnPropertyDescriptor(Object,"fromEntries");Object.defineProperty(Object,"fromEntries",{configurable:true,get(){trace.push("fromEntries lookup");return descriptor.value;}});
    try{const runtime=await module.resolveFixtureRuntime(cmd,services,{},()=>{},{});return {trace,names:Object.keys(runtime.services),secret:runtime.env.get("TOOLCRAFT_TEST_SECRET")};}finally{Object.defineProperty(Object,"fromEntries",descriptor);}
  }
  assert.deepEqual(await inspect(api,nativeDefinitions),await inspect(original,referenceDefinitions));
});
