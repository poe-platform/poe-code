import assert from "node:assert/strict";
import {afterEach,it,vi} from "vitest";

const proxy=vi.hoisted(()=>({resolveMcpProxies:vi.fn(),disposeMcpProxies:vi.fn()}));
vi.mock("../dist/mcp-proxy.js",()=>proxy);
vi.mock("../../toolcraft/dist/mcp-proxy.js",()=>proxy);
const native=await import("../dist/cli.js"),reference=await import("../../toolcraft/dist/cli.js");
const nativeDefinitions=await import("../dist/index.js"),referenceDefinitions=await import("../../toolcraft/dist/index.js");
const exitCode=process.exitCode;
afterEach(()=>{process.exitCode=exitCode;vi.restoreAllMocks();vi.clearAllMocks();});

async function inspect(api,definitions,mode){
  process.exitCode=0;
  const trace=[],output=[],stderr=[];
  const root=definitions.defineGroup({name:"app",children:[],mcp:{transport:"stdio",command:"fixture"}});
  proxy.resolveMcpProxies.mockImplementation(async (resolved,options)=>{
    assert.equal(resolved,root);trace.push(["discover",options]);
    if(mode==="discovery-error")throw new definitions.UserError("discovery failed");
    root.children.push(definitions.defineCommand({name:"remote",params:definitions.S.Object({}),handler(){trace.push("handler");return {ok:true};}}));
  });
  proxy.disposeMcpProxies.mockImplementation(async resolved=>{assert.equal(resolved,root);trace.push("dispose");if(mode==="cleanup-error")throw new Error("close failed");});
  const write=vi.spyOn(process.stderr,"write").mockImplementation(chunk=>{stderr.push(String(chunk));return true;});
  const stdout=vi.spyOn(process.stdout,"write").mockImplementation(chunk=>{output.push(["stdout",String(chunk)]);return true;});
  try{
    const options={argv:["node","app",...(mode==="help"?["--help","--output=json"]:["remote","--output=json"])],version:"1",projectRoot:"/workspace",errorReports:false,controls:{output:true},outputEmitter:chunk=>output.push(chunk)};
    if(mode==="embedded"){
      const invocation={signal:new AbortController().signal,write:(chunk,stream)=>output.push([stream,chunk]),flush:async()=>{trace.push("flush");},exitCode:0};
      await api.executeCLICommand(root,options,invocation);
      return {trace,output,stderr,exitCode:invocation.exitCode};
    }
    await api.runCLI(root,options);
    return {trace,output,stderr,exitCode:process.exitCode};
  }finally{write.mockRestore();stdout.mockRestore();}
}

it("Native CLI discovers proxy commands and closes them after execution or help",async()=>{
  for(const mode of ["execute","help"]){const actual=await inspect(native,nativeDefinitions,mode);assert.deepEqual(actual,await inspect(reference,referenceDefinitions,mode));assert.equal(actual.trace.at(-1),"dispose");assert.equal(actual.exitCode,0);}
});
it("Native CLI matches discovery failure and cleanup failure handling",async()=>{
  for(const mode of ["discovery-error","cleanup-error"]){const actual=await inspect(native,nativeDefinitions,mode);assert.deepEqual(actual,await inspect(reference,referenceDefinitions,mode));assert.equal(actual.exitCode,1);assert.equal(actual.trace.includes("dispose"),mode==="cleanup-error");}
});
it("Native embedded CLI rejects proxy discovery and still flushes",async()=>{
  const actual=await inspect(native,nativeDefinitions,"embedded");assert.deepEqual(actual,await inspect(reference,referenceDefinitions,"embedded"));assert.deepEqual(actual.trace,["flush"]);assert.equal(actual.exitCode,1);
});
