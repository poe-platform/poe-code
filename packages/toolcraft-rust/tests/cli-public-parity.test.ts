import assert from "node:assert/strict";
import {it,afterEach,beforeEach,vi} from "vitest";
import * as nativeDefinitions from "../dist/index.js";
import * as referenceDefinitions from "../../toolcraft/dist/index.js";
import * as original from "../../toolcraft/dist/cli.js";
import * as api from "../dist/cli.js";
import {ApprovalDeclinedError} from "../dist/approval-error.js";
const initialExitCode=process.exitCode;
beforeEach(()=>{vi.stubEnv("TOOLCRAFT_FIXTURE","");process.exitCode=0;});
afterEach(()=>{vi.unstubAllEnvs();process.exitCode=initialExitCode;vi.restoreAllMocks();});
function makeRoot(definitions,trace){
  const S=definitions.S;
  const command=definitions.defineCommand({name:"run",aliases:["r"],params:S.Object({name:S.String(),labels:S.Optional(S.Record(S.String()))}),positional:["name"],handler(context){trace.push([context.params,context.injected]);return {hello:context.params.name,labels:context.params.labels};}});
  const group=definitions.defineGroup({name:"jobs",children:[command]});
  return definitions.defineGroup({name:"app",children:[command,group]});
}
async function embedded(module,definitions,argv,extra={}){
  const trace=[],output=[],controller=new AbortController(),invocation={signal:controller.signal,write(chunk,stream="stdout"){output.push([stream,chunk]);},async flush(){trace.push("flush");},exitCode:0,capabilities:{injected:"capability"},...extra.invocation};
  let error;
  try{await module.executeCLICommand(makeRoot(definitions,trace),{argv:["node","app",...argv],version:"1.2.3",controls:{yes:true,output:true,debug:true,verbose:true},errorReports:false,...extra.options},invocation);}catch(failure){error=failure;}
  return {trace,output,exitCode:invocation.exitCode,error};
}
it("Native public CLI executes aliases and nested dynamic flags through the embedded runtime",async()=>{
  const argv=["jobs","r","workspace","--labels.tag=hello","--yes","--output=json"];
  const actual=await embedded(api,nativeDefinitions,argv);assert.deepEqual(actual,await embedded(original,referenceDefinitions,argv));assert.equal(actual.exitCode,0);assert.deepEqual(actual.trace[0],[{name:"workspace",labels:{tag:"hello"}},"capability"]);
});
it("Native public CLI emits generated help and version output through the invocation",async()=>{
  for(const argv of [[],["--help"],["run","--help"],["jobs","run","--help","--output=json"],["--version"]])assert.deepEqual(await embedded(api,nativeDefinitions,argv),await embedded(original,referenceDefinitions,argv));
});
it("Native public CLI preserves usage diagnostics, defaults and abort rejection",async()=>{
  for(const argv of [["rnu"],["run"],["run","workspace","--unknown"],["run","workspace","--output=unknown"]])assert.deepEqual(await embedded(api,nativeDefinitions,argv),await embedded(original,referenceDefinitions,argv));
  const defaults={run:{name:"default"}};assert.deepEqual(await embedded(api,nativeDefinitions,["run","--yes","--output=json"],{invocation:{defaults}}),await embedded(original,referenceDefinitions,["run","--yes","--output=json"],{invocation:{defaults}}));
  for(const module of [api,original]){const controller=new AbortController(),failure=Symbol("abort");controller.abort(failure);const result=await embedded(module,module===api?nativeDefinitions:referenceDefinitions,["run","workspace"],{invocation:{signal:controller.signal}});assert.equal(result.error,failure);}
});
it("Native public CLI retains the standalone runCLI output and exit behavior",async()=>{
  async function inspect(module,definitions,argv){const trace=[],output=[],errors=[];process.exitCode=0;const stderr=vi.spyOn(process.stderr,"write").mockImplementation(chunk=>{errors.push(String(chunk));return true;});try{await module.runCLI(makeRoot(definitions,trace),{argv:["node","app",...argv],version:"1",errorReports:false,controls:{yes:true,output:true},outputEmitter:entry=>output.push(entry)});return {trace,output,errors,exitCode:process.exitCode};}finally{stderr.mockRestore();}}
  for(const argv of [["run","workspace","--yes","--output=json"],["rnu"],["run"]])assert.deepEqual(await inspect(api,nativeDefinitions,argv),await inspect(original,referenceDefinitions,argv));
});
it("Native root and approval modules share the same declined-error constructor",()=>{
  assert.equal(nativeDefinitions.ApprovalDeclinedError,ApprovalDeclinedError);
  assert.ok(new ApprovalDeclinedError({reason:"declined"}) instanceof nativeDefinitions.UserError);
  assert.deepEqual(Object.keys(api).sort(),Object.keys(original).sort());
});
it("Native public CLI preserves option getter order and invocation cleanup failures",async()=>{
  async function inspect(module,definitions,argv){
    const trace=[],output=[];
    const options=new Proxy({argv:["node","app",...argv],version:"1",errorReports:false,controls:{yes:true,output:true}},{get(target,key,receiver){trace.push(String(key));return Reflect.get(target,key,receiver);}});
    const invocation={signal:new AbortController().signal,write(chunk,stream="stdout"){output.push([stream,chunk]);},flush(){trace.push("flush");return {then(resolve){trace.push("flush:then");resolve();}};},capabilities:{},exitCode:0};
    await module.executeCLICommand(makeRoot(definitions,[]),options,invocation);
    return {trace,output,exitCode:invocation.exitCode};
  }
  for(const argv of [[],["run","example","--output=json"],["rnu"],["run","--unknown"]])assert.deepEqual(await inspect(api,nativeDefinitions,argv),await inspect(original,referenceDefinitions,argv));
  for(const module of [api,original]){
    const failure=Symbol("flush failure");
    const result=await embedded(module,module===api?nativeDefinitions:referenceDefinitions,["run","sample"],{invocation:{flush(){throw failure;}}});
    assert.equal(result.error,failure);
    let flushed=false;
    await assert.rejects(()=>module.executeCLICommand([], {get controls(){throw failure;}}, {flush(){flushed=true;}}),value=>value===failure);
    assert.equal(flushed,false);
  }
});
it("Native public CLI keeps concurrent invocation continuations and writers independent",async()=>{
  async function inspect(module,definitions){
    const pending=new Map(),trace=[];
    const command=definitions.defineCommand({name:"run",params:definitions.S.Object({id:definitions.S.String()}),handler:({params})=>new Promise(resolve=>{trace.push(params.id);pending.set(params.id,resolve);})});
    const root=definitions.defineGroup({name:"app",children:[command]});
    const output=[[],[]];
    const tasks=output.map((chunks,index)=>module.executeCLICommand(root,{argv:["node","app","run","--id",String(index),"--output=json"],controls:{output:true},errorReports:false},{signal:new AbortController().signal,capabilities:{},exitCode:0,write(chunk,stream="stdout"){chunks.push([stream,chunk]);},async flush(){trace.push(`flush:${index}`);}}));
    await vi.waitFor(()=>assert.equal(pending.size,2));
    pending.get("1")({id:"second"});await tasks[1];
    pending.get("0")({id:"first"});await tasks[0];
    return {trace,output};
  }
  const actual=await inspect(api,nativeDefinitions);assert.deepEqual(actual,await inspect(original,referenceDefinitions));
  assert.deepEqual(actual.trace,["0","1","flush:1","flush:0"]);
});
