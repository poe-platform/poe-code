import assert from "node:assert/strict";
import {afterEach,beforeEach,it,vi} from "vitest";
import * as nativeDefinitions from "../dist/index.js";
import * as referenceDefinitions from "../../toolcraft/dist/index.js";
import * as nativeFields from "../dist/cli-fields.js";
import {original as referenceFields} from "./cli-commands-reference.mjs";
import * as nativeDesign from "toolcraft-design-rust";
import * as referenceDesign from "../../toolcraft-design/dist/index.js";
import * as nativeCommands from "../dist/cli-commands.js";
import * as nativePreparation from "../dist/cli-prepare.js";
import {original as referenceCommands} from "./cli-commands-reference.mjs";
import {original as referencePreparation} from "./cli-prepare-reference.mjs";
import * as nativeSchema from "toolcraft-schema-rust";
import * as referenceSchema from "../../toolcraft-schema/dist/index.js";
import {loadExecutionReference} from "./cli-execution-reference.mjs";
const confirm=vi.hoisted(()=>vi.fn());
vi.mock("toolcraft-design-rust",async importOriginal=>({...await importOriginal(),confirm}));
const original=loadExecutionReference({confirm});
import * as api from "../dist/cli-execution.js";
const initialExitCode=process.exitCode;
beforeEach(()=>{confirm.mockReset().mockResolvedValue(true);vi.stubEnv("TOOLCRAFT_FIXTURE","");process.exitCode=0;nativeDesign.configureTheme({brand:"blue",label:"Toolcraft"});referenceDesign.configureTheme({brand:"blue",label:"Toolcraft"});});
afterEach(()=>{vi.unstubAllEnvs();process.exitCode=initialExitCode;});
const globals=new Set(["--help","--yes","--output","--verbose","--debug","--log-level","--preset"]);
async function run(module:typeof original,definitions:typeof nativeDefinitions,fieldsApi:typeof nativeFields,setup:(trace:unknown[],definitions:typeof nativeDefinitions)=>any=()=>({}),embedded=false){
  const trace:unknown[]=[],output:string[]=[],reports:unknown[]=[],controller=new AbortController();
  const options=setup(trace,definitions),S=definitions.S;
  const config={name:"run",params:S.Object({name:S.String()}),handler:context=>{trace.push(["handler",context.params]);return {hello:context.params.name};},...options.config};
  const defined=options.stream?definitions.defineStreamCommand(config):definitions.defineCommand(config);
  const command=options.command?.(defined)??defined;
  const collected=fieldsApi.collectFields(command.params,"kebab",globals);
  const parent={parent:null,opts:()=>({output:"json",...options.parentFlags})};
  const actionCommand={parent,opts:()=>({yes:true,name:"workspace",...options.flags})};
  const state={command,commandPath:"app.run",declarationPath:["run"],casing:"kebab",...collected,positionalValues:[],rawArgv:options.raw??[],presetsEnabled:false,actionCommand};
  const invocation=embedded?{signal:controller.signal,write(chunk,stream="stdout"){output.push(stream+":"+chunk);options.write?.(chunk,stream);},async flush(){trace.push("flush");await options.flush?.(controller);},exitCode:0,capabilities:{custom:"capability"},defaults:options.defaults}:undefined;
  if(options.abort)controller.abort(options.abort);
  const diagnostics={verboseControlEnabled:true,logger:event=>trace.push(["diagnostic",event]),...options.diagnostics};
  let error;
  try{await module.executeCommand(options.state?.(state)??state,"app",{service:"injected"},options.requirements??{},async()=>{throw new Error("Unexpected fetch");},options.humanInLoop,options.env??{},options.fs,entry=>{output.push(entry);options.emit?.(entry);},options.formats??{},options.streams??{},diagnostics,function(context){reports.push({name:context.command.name,path:context.commandPath,params:context.params,secrets:context.secrets});options.report?.(context,this);},invocation);}catch(failure){options.caught?.(failure);error={name:failure?.name,message:failure?.message};}
  return {trace,output,reports,error,exitCode:invocation?.exitCode??process.exitCode};
}
async function compare(api:typeof original,setup?,embedded=false){const actual=await run(api,nativeDefinitions,nativeFields,setup,embedded),expected=await run(original,referenceDefinitions,referenceFields,setup,embedded);assert.deepEqual(actual,expected);return actual;}

it("Native CLI execution resolves arguments, runs handlers and renders ordinary or embedded results",async()=>{
  for(const embedded of [false,true]){const actual=await compare(api,undefined,embedded);assert.deepEqual(actual.trace,[["handler",{name:"workspace"}]]);assert.ok(actual.output.join("").includes('"hello": "workspace"'));assert.deepEqual(actual.reports,[]);}
  await compare(api,trace=>({flags:{output:"custom"},formats:{custom:({commandPath,result})=>commandPath+":"+JSON.stringify(result)},config:{handler(context){trace.push([context.service,context.custom,context.params]);return "rendered";}}}),true);
});

it("Native CLI execution orders requirements, defaults, diagnostics and error context",async()=>{
  const setup=(trace)=>({flags:{name:undefined,verbose:true},defaults:{run:{name:"default"}},config:{requires:{check(context){trace.push(["check",context.params]);return {ok:true};}},handler(context){context.progress("working");context.diagnostics.emit({level:"debug",message:"detail"});trace.push(["handler",context.params]);return {ok:true};}}});
  await compare(api,setup,true);
  const invalid=await compare(api,()=>({flags:{name:undefined}}));assert.ok(invalid.error.message.includes("Missing required parameter"));assert.equal(invalid.reports[0].params,undefined);
  await compare(api,()=>({config:{requires:{check:()=>({ok:false,message:"blocked"})}}}),true);
  await compare(api,()=>({abort:new Error("cancelled before handler")}),true);
});

it("Native CLI execution enforces embedded confirmation and legacy interactive cancellation",async()=>{
  const setup=()=>({flags:{yes:false},streams:{input:{isTTY:true},output:{isTTY:true}},config:{confirm:true}});
  const embedded=await compare(api,setup,true);assert.equal(embedded.error.message,"Confirmation required; supply --yes to authorize this command.");
  await compare(api,setup);
  confirm.mockResolvedValue(false);const cancelled=await compare(api,setup);assert.equal(cancelled.error.message,"Operation cancelled.");assert.deepEqual(cancelled.reports[0].params,{name:"workspace"});
});

it("Native CLI execution routes approvals, MCP errors and handler failures",async()=>{
  for(const output of ["rich","json"])await compare(api,()=>({flags:{output},config:{humanInLoop:{mode:"async",message:()=>"Review change"}},humanInLoop:{async invoke(){return {status:"pending-approval",approvalId:"id-1",message:"Review change",enqueuedAt:"2026-01-01"};}}}));
  await compare(api,(_trace,definitions)=>({config:{handler:()=>definitions.asMCPResult({content:[{type:"text",text:"failure"}],isError:true})}}),true);
  const failure=await compare(api,()=>({config:{handler(){throw new Error("handler failed");}}}));assert.equal(failure.error.message,"handler failed");assert.deepEqual(failure.reports[0].params,{name:"workspace"});
});

it("Native CLI execution streams JSON events and flushes embedded output",async()=>{
  const setup=(trace,definitions)=>({stream:true,config:{event:definitions.S.Object({value:definitions.S.Number()}),async *handler(context){trace.push(["handler",context.params,context.custom]);yield {value:1};yield {value:2};trace.push("finished");}}});
  for(const embedded of [false,true]){const actual=await compare(api,setup,embedded);assert.ok(actual.output.join("").includes('"value":1'));assert.ok(actual.output.join("").includes('"value":2'));}
});

it("Native CLI execution preserves rejection identity and the error-report boundary",async()=>{
  for(const failure of [undefined,null,false,17,Symbol("failure"),new Error("failure")]){
    for(const phase of ["runtime","requirements","handler","render","report"]){
      const setup=(trace)=>({
        caught(error){assert.equal(error,failure);trace.push("caught");},
        report(_context,receiver){assert.equal(receiver,undefined);trace.push("reported");if(phase==="report")throw failure;},
        ...(phase==="runtime"?{env:{get EXEC_TEST_TOKEN(){throw failure;}}}:{}),
        config:{...(phase==="runtime"?{secrets:{token:{env:"EXEC_TEST_TOKEN"}}}:{}),
          requires:{check(){if(phase==="requirements")throw failure;return {ok:true};}},
          handler(){if(phase==="handler"||phase==="report")return Promise.reject(failure);return "done";}},
        ...(phase==="render"?{flags:{output:"custom"},formats:{custom(){throw failure;}}}:{})
      });
      const actual=await compare(api,setup);assert.deepEqual(actual.trace,phase==="runtime"?["caught"]:["reported","caught"]);
      assert.equal(actual.reports.length,phase==="runtime"?0:1);
    }
  }
});

it("Native CLI execution closes streams after flush, emitter and handler failures",async()=>{
  for(const phase of ["flush","emit","handler","abort"]){
    const failure=new Error(phase+" failed");
    const setup=(trace,definitions)=>({stream:true,
      config:{event:definitions.S.Object({value:definitions.S.Number()}),async *handler(){try{trace.push("start");yield {value:1};if(phase==="handler")throw failure;yield {value:2};}finally{trace.push("closed");}}},
      ...(phase==="flush"?{flush(){throw failure;}}:{}),
      ...(phase==="emit"?{emit(){throw failure;}}:{}),
      ...(phase==="abort"?{flush(controller){controller.abort(failure);}}:{}),
      caught(error){assert.equal(error,failure);}
    });
    const listeners=process.listeners("SIGINT");
    const actual=await compare(api,setup,phase!=="emit");assert.ok(actual.error);assert.ok(actual.trace.includes("closed"));assert.equal(actual.reports.length,1);
    assert.deepEqual(process.listeners("SIGINT"),listeners);
  }
});

it("Native CLI execution preserves callback receivers, live property order and await timing",async()=>{
  const setup=(trace)=>{
    const track=(value,label)=>new Proxy(value,{get(target,key,receiver){trace.push([label,String(key)]);return Reflect.get(target,key,receiver);}});
    let command;
    const config={handler(context){trace.push(["handler receiver",this===command,context.params]);return {get then(){trace.push("then");return resolve=>{trace.push("resolve");resolve({ok:true});};}};}};
    return {config,command(value){command=track(value,"command");return command;},state(value){return track(value,"state");},flags:{output:"custom"},formats:{custom:function({command:rendered}){trace.push(["render receiver",this===undefined,rendered===command]);return "done";}}};
  };
  await compare(api,setup,true);await compare(api,setup,false);
});

it("Native CLI execution validates native JSON schemas before calling the handler",async()=>{
  for(const embedded of [false,true]){
    const setup=(trace,definitions)=>({flags:{name:"bad"},config:{params:(definitions===nativeDefinitions?nativeSchema:referenceSchema).withJsonSchema(definitions.S.Object({name:definitions.S.String()}),{type:"object",properties:{name:{type:"string"}},required:["name"],not:{properties:{name:{const:"bad"}}}}),handler(){trace.push("unexpected handler");}}});
    const actual=await compare(api,setup,embedded);assert.ok(actual.error);assert.deepEqual(actual.trace,[]);assert.equal(actual.reports[0].params,undefined);
  }
});

it("Native CLI helpers preserve output routing, flag inheritance and diagnostic filtering",()=>{
  function inspect(module){
    const trace=[],root={parent:null,opts(){trace.push(["root",this===root]);return {yes:false,name:"root"};}},leaf={parent:root,opts(){trace.push(["leaf",this===leaf]);return {name:"leaf"};}};
    assert.deepEqual(module.getResolvedFlags(leaf),{yes:false,name:"leaf"});
    const stdout=vi.spyOn(process.stdout,"write").mockImplementation(chunk=>{trace.push(["stdout",chunk]);return true;});
    const stderr=vi.spyOn(process.stderr,"write").mockImplementation(chunk=>{trace.push(["stderr",chunk]);return true;});
    try{
      for(const event of [{message:"normal",level:"info"},{message:"hidden",level:"trace"},{message:"hidden",category:"progress"},{data:{transcript:"raw"},category:"progress"},{data:{transcript:""},level:"trace"}])module.writeCLIDiagnosticEvent(event);
      module.writeRichHeader("run");
      const pending={status:"pending-approval",approvalId:"id",message:"review",enqueuedAt:"now"};
      for(const value of [undefined,null,false,()=>pending,pending,{...pending,enqueuedAt:0}])trace.push(module.isHumanInLoopPending(value));
      module.renderHumanInLoopPending(pending,"app");
      for(const payload of [undefined,"","hello\n"]){
        const formats={custom:function(){trace.push(["renderer",this===undefined]);return payload;}};
        for(const destination of [undefined,"write","exact"]){
          const write=destination===undefined?undefined:chunk=>trace.push(["write",chunk]);
          const exact=destination==="exact"?chunk=>trace.push(["exact",chunk]):undefined;
          trace.push(module.renderCLIResult({},"app.run",{},"custom",{},formats,write,exact));
        }
      }
    }finally{stdout.mockRestore();stderr.mockRestore();}
    return trace;
  }
  assert.deepEqual(inspect(api),inspect(original));
});

it("Native command trees and argument preparation compose with complete command execution",async()=>{
  const controls={yes:true,output:true,outputFormats:{},debug:true,logLevel:true,verbose:true};
  async function inspect(commands,preparation,execution,definitions){
    const trace=[],output=[],S=definitions.S;
    const node=definitions.defineCommand({name:"run",aliases:["r"],positional:["name"],params:S.Object({name:S.String(),values:S.Array(S.Number()),labels:S.Record(S.String())}),handler(context){trace.push(context.params);return context.params;}});
    const root=definitions.defineGroup({name:"app",children:[node]}),loaders=new Map();
    const command=commands.createNodeCommand(root,"kebab",globals,state=>execution.executeCommand(state,"app",{},{},fetch,undefined,{},undefined,entry=>output.push(entry),{},{},{verboseControlEnabled:true}),false,controls,loaders);
    const prepared=preparation.prepareCliArguments(command,["node","app","r","workspace","--values","-1,-2","--labels.tag","hello","--yes","--output","json"],loaders,"kebab",controls);
    await command.parseAsync(prepared.argv);return {trace,output};
  }
  const actual=await inspect(nativeCommands,nativePreparation,api,nativeDefinitions);
  assert.deepEqual(actual,await inspect(referenceCommands,referencePreparation,original,referenceDefinitions));
  assert.deepEqual(actual.trace,[{name:"workspace",values:[-1,-2],labels:{tag:"hello"}}]);assert.deepEqual(JSON.parse(actual.output.join("")),actual.trace[0]);
});

it("Native CLI streams retain status diagnostics, secret refresh and custom output",async()=>{
  const setup=(trace,definitions)=>({stream:true,flags:{output:"custom"},env:{EXEC_TEST_TOKEN:"synthetic"},
    formats:{custom:({result})=>"event:"+result.value+"\n"},
    config:{secrets:{token:{env:"EXEC_TEST_TOKEN"}},event:definitions.S.Object({value:definitions.S.Number()}),async *handler(context){context.status({type:"connected",message:"ready"});trace.push(["secrets",await context.refreshSecrets()]);yield {value:1};}}
  });
  const actual=await compare(api,setup,true);assert.ok(actual.output.includes("event:1\n"));assert.ok(actual.trace.some(entry=>Array.isArray(entry)&&entry[0]==="secrets"));
});

it("Native CLI execution isolates concurrent handler continuations",async()=>{
  for(const [module,definitions,fields] of [[api,nativeDefinitions,nativeFields],[original,referenceDefinitions,referenceFields]]){
    const releases=[],started=[];
    const ready=new Promise<void>(resolve=>started.push(resolve));
    const setup=value=>()=>({flags:{name:value},config:{handler(context){return new Promise(resolve=>{releases.push(()=>resolve(context.params));if(releases.length===2)started[0]();});}}});
    const first=run(module,definitions,fields,setup("first"),true),second=run(module,definitions,fields,setup("second"),true);
    await ready;releases[1]();const secondResult=await second;assert.ok(secondResult.output.join("").includes('"second"'));
    releases[0]();const firstResult=await first;assert.ok(firstResult.output.join("").includes('"first"'));assert.deepEqual(firstResult.reports,[]);assert.deepEqual(secondResult.reports,[]);
  }
});
